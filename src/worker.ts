/// <reference lib="webworker" />

import { ZipReader } from "@gmaclennan/zip-reader";
import { BlobSource } from "@gmaclennan/zip-reader/blob-source";
import { MBTiles } from "mbtiles-reader";
import type { Reader as SmpReader } from "styled-map-package-api/reader";
import { layerStyles } from "./layer-styles.ts";

const MBTILES_FILENAME = "tiles.mbtiles";
const SMP_URI_BASE = "smp://maps.v1/";

type OpenedFile =
  | { kind: "mbtiles"; mbtiles: MBTiles }
  | { kind: "smp"; reader: SmpReader };

let openedPromise: Promise<OpenedFile> | undefined;

// Request access to the OPFS
const rootPromise = navigator.storage.getDirectory().then(async (root) => {
  // Cleanup on startup, in case last run did not clean up.
  await root.removeEntry(MBTILES_FILENAME).catch(() => {});
  return root;
});

addEventListener("message", async (event) => {
  switch (event.data.type) {
    case "file":
      openedPromise = openFile(event.data.payload);
      openedPromise.catch(() => {});
      return;
    case "beforeunload": {
      const opened = await openedPromise?.catch(() => undefined);
      if (opened?.kind === "mbtiles") opened.mbtiles.close();
      if (opened?.kind === "smp") opened.reader.close();
      (await rootPromise).removeEntry(MBTILES_FILENAME).catch(() => {});
      return;
    }
    case "resourceRequest":
      await handleResourceRequest(event.data);
      return;
    case "generateSmp":
      await handleGenerateSmp(event.data.port);
      return;
  }
});

async function openFile(file: File): Promise<OpenedFile> {
  try {
    const kind = await detectFileKind(file);
    if (kind === "smp") {
      const { Reader } = await import("styled-map-package-api/reader");
      // Reads ranges straight from the File, so unlike MBTiles no OPFS copy is needed
      const reader = new Reader(await ZipReader.from(new BlobSource(file)));
      const style = await reader.getStyle();
      postMessage({
        type: "opened",
        payload: { kind, fileName: file.name, style },
      });
      return { kind, reader };
    }
    await copyFileToOpfs(file, MBTILES_FILENAME);
    const mbtiles = await MBTiles.open(MBTILES_FILENAME);
    postMessage({
      type: "opened",
      payload: { kind, fileName: file.name, metadata: mbtiles.metadata },
    });
    return { kind, mbtiles };
  } catch (err) {
    postMessage({ type: "openError", error: errorMessage(err) });
    throw err;
  }
}

async function detectFileKind(file: File): Promise<OpenedFile["kind"]> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    header[2] === 0x03 &&
    header[3] === 0x04
  ) {
    return "smp";
  }
  if (new TextDecoder().decode(header) === "SQLite format 3\0") {
    return "mbtiles";
  }
  throw new Error(
    `${file.name} is not an MBTiles or Styled Map Package (.smp) file`,
  );
}

async function handleResourceRequest({
  payload: { url },
  id,
}: {
  payload: { url: string };
  id: number;
}) {
  if (typeof url !== "string" || typeof id !== "number") {
    throw new TypeError("Invalid Message");
  }
  try {
    const opened = await openedPromise;
    if (!opened) throw new Error("No file opened");
    const data =
      opened.kind === "smp"
        ? await getSmpResource(opened.reader, url)
        : getMbtilesTile(opened.mbtiles, url);
    const payload = await gunzipIfNeeded(data);
    postMessage({ id, payload }, { transfer: [payload] });
  } catch (err) {
    postMessage({ id, error: errorMessage(err) });
  }
}

function getMbtilesTile(mbtiles: MBTiles, url: string): Uint8Array {
  const match = url.match(/(\d+)\/(\d+)\/(\d+)$/);
  if (!match) throw new Error(`Invalid tile URL: ${url}`);
  const [z, x, y] = match.slice(1).map(Number);
  return mbtiles.getTile({ z, x, y }).data;
}

async function getSmpResource(
  reader: SmpReader,
  url: string,
): Promise<Uint8Array> {
  if (!url.startsWith(SMP_URI_BASE)) {
    throw new Error(`Invalid SMP URL: ${url}`);
  }
  // MapLibre percent-encodes font stacks in glyph URLs; zip entry names are raw
  const path = decodeURIComponent(url.slice(SMP_URI_BASE.length));
  const { stream } = await reader.getResource(path);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipIfNeeded(data: Uint8Array): Promise<ArrayBuffer> {
  const isGzipped = data[0] === 0x1f && data[1] === 0x8b;
  if (!isGzipped) {
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
  }
  const decompressed = new Response(data as BodyInit).body!.pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Response(decompressed).arrayBuffer();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const WRITE = 0;
const PULL = 0;
const ERROR = 1;
const ABORT = 1;
const CLOSE = 2;

async function handleGenerateSmp(port: MessagePort) {
  try {
    const opened = await openedPromise;
    if (opened?.kind !== "mbtiles") {
      throw new Error("Only MBTiles files can be exported to SMP");
    }
    const stream = await createSmpStream(opened.mbtiles);
    const writable = new WritableStream(new MessagePortSink(port));
    await stream.pipeTo(writable);
    postMessage({ type: "smpComplete" });
  } catch (err) {
    port.postMessage({ type: ABORT, reason: String(err) });
    port.close();
    postMessage({ type: "smpError", error: String(err) });
  }
}

/** WritableStream sink that sends chunks over a MessagePort with backpressure */
class MessagePortSink implements UnderlyingSink<Uint8Array> {
  #port: MessagePort;
  #controller!: WritableStreamDefaultController;
  #readyResolve!: () => void;
  #readyReject!: (reason: any) => void;
  #readyPromise!: Promise<void>;

  constructor(port: MessagePort) {
    this.#port = port;
    port.onmessage = (event) => this.#onMessage(event.data);
    this.#resetReady();
  }

  start(controller: WritableStreamDefaultController) {
    this.#controller = controller;
    return this.#readyPromise;
  }

  write(chunk: Uint8Array) {
    this.#port.postMessage({ type: WRITE, chunk }, [chunk.buffer]);
    this.#resetReady();
    return this.#readyPromise;
  }

  close() {
    this.#port.postMessage({ type: CLOSE });
    this.#port.close();
  }

  abort(reason: any) {
    this.#port.postMessage({ type: ABORT, reason: String(reason) });
    this.#port.close();
  }

  #onMessage(message: { type: number; reason?: any }) {
    if (message.type === PULL) this.#readyResolve();
    if (message.type === ERROR) {
      this.#controller.error(message.reason);
      this.#readyReject(message.reason);
      this.#port.close();
    }
  }

  #resetReady() {
    this.#readyPromise = new Promise((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
  }
}

const SOURCE_ID = "mbtiles-source";

async function createSmpStream(
  reader: MBTiles,
): Promise<ReadableStream<Uint8Array>> {
  const { Writer } = await import("styled-map-package-api/writer");

  const metadata = reader.metadata;
  const isVector = metadata.format === "pbf";
  const background = {
    id: "background",
    type: "background",
    paint: { "background-color": "white" },
  };

  const style = {
    version: 8,
    name: metadata.name,
    sources: {
      [SOURCE_ID]: {
        ...metadata,
        type: isVector ? "vector" : "raster",
        tileSize: isVector ? 512 : 256,
      },
    },
    layers: isVector
      ? [
          background,
          // mbtiles-reader spreads the `json` metadata row in, but its type omits it
          ...layerStyles(
            (metadata as { vector_layers?: { id: string }[] }).vector_layers ||
              [],
            SOURCE_ID,
          ),
        ]
      : [
          background,
          {
            id: "raster",
            type: "raster",
            source: SOURCE_ID,
            paint: { "raster-opacity": 1 },
          },
        ],
  };

  const writer = new Writer(style, { dedupe: true });

  // Pipe tiles asynchronously — writer.outputStream is readable immediately
  (async () => {
    try {
      const tileWriteStream = writer.createTileWriteStream();
      const writable = tileWriteStream.getWriter();

      for (const tile of reader) {
        await writable.write([
          tile.data,
          {
            z: tile.z,
            x: tile.x,
            y: tile.y,
            format: tile.format,
            sourceId: SOURCE_ID,
          },
        ]);
      }

      await writable.close();
      await writer.finish();
    } catch (err) {
      writer.abort(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return writer.outputStream;
}

async function copyFileToOpfs(file: File, name: string) {
  const root = await rootPromise;

  const opfsFileHandle = await root.getFileHandle(name, {
    create: true,
  });
  // Create a writable stream in OPFS
  const accessHandle = await opfsFileHandle.createSyncAccessHandle();
  try {
    // A previous failed open may have left a longer file behind
    accessHandle.truncate(0);
    // Set the position for writing
    let position = 0;

    // Create a reader for the file stream
    const reader = file.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Write the chunk to the OPFS
      accessHandle.write(value, { at: position });
      // Update the position for the next chunk
      position += value.byteLength;
    }
  } finally {
    accessHandle.flush();
    accessHandle.close();
  }
}
