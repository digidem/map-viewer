/// <reference lib="webworker" />

import { MBTiles } from "mbtiles-reader";
import { pEvent } from "p-event";

const MBTILES_FILENAME = "tiles.mbtiles";
let mbtiles: MBTiles | undefined;

// Request access to the OPFS
const rootPromise = navigator.storage.getDirectory().then(async (root) => {
  // Cleanup on startup, in case last run did not clean up.
  await root.removeEntry(MBTILES_FILENAME).catch(() => {});
  return root;
});

const mbtilesPromise = pEvent<string, MessageEvent<any>>(
  self,
  "message",
  (event) => event.data.type === "file",
).then(async ({ data }) => {
  const file = data.payload as File;
  await copyFileToOpfs(file, MBTILES_FILENAME);
  const instance = await MBTiles.open(MBTILES_FILENAME);

  postMessage({
    type: "metadata",
    payload: { ...instance.metadata, fileName: file.name },
  });

  return instance;
});

addEventListener("message", async (event) => {
  switch (event.data.type) {
    case "beforeunload":
      mbtiles?.close();
      (await rootPromise).removeEntry(MBTILES_FILENAME).catch(() => {});
      return;
    case "tileRequest":
      await handleTileRequest(event.data);
      return;
    case "generateSmp":
      await handleGenerateSmp(event.data.port);
      return;
  }
});

const WRITE = 0;
const PULL = 0;
const ERROR = 1;
const ABORT = 1;
const CLOSE = 2;

async function handleGenerateSmp(port: MessagePort) {
  try {
    mbtiles = mbtiles ?? (await mbtilesPromise);
    const stream = await createSmpStream(mbtiles);
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

  const style = {
    version: 8,
    name: metadata.name,
    sources: {
      [SOURCE_ID]: {
        ...metadata,
        type: metadata.format === "pbf" ? "vector" : "raster",
        tileSize: metadata.format === "pbf" ? 512 : 256,
      },
    },
    layers:
      metadata.format === "pbf"
        ? [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "white" },
            },
          ]
        : [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "white" },
            },
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

async function handleTileRequest({
  payload: { z, x, y },
  id,
}: {
  payload: { z: number; x: number; y: number };
  id: number;
}) {
  if (
    typeof z !== "number" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof id !== "number"
  ) {
    throw new TypeError("Invalid Message");
  }
  mbtiles = mbtiles ?? (await mbtilesPromise);

  try {
    const tile = mbtiles.getTile({ z, x, y });
    const isGzipped = tile.data[0] === 0x1f && tile.data[1] === 0x8b;
    const payload = isGzipped
      ? await gunzip(tile.data.buffer as ArrayBuffer)
      : (tile.data.buffer as ArrayBuffer);

    postMessage({ id, payload }, { transfer: [payload] });
  } catch {
    postMessage({ id, error: "Tile not found" });
  }
}

async function gunzip(inputBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const decompressionStream = new DecompressionStream("gzip");
  const inputStream = new Response(inputBuffer)
    .body as ReadableStream<Uint8Array>;
  const decompressedStream = inputStream.pipeThrough(
    decompressionStream as any,
  );
  return new Response(decompressedStream).arrayBuffer();
}

async function copyFileToOpfs(file: File, name: string) {
  const root = await rootPromise;

  const opfsFileHandle = await root.getFileHandle(name, {
    create: true,
  });
  // Create a writable stream in OPFS
  const accessHandle = await opfsFileHandle.createSyncAccessHandle();
  try {
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
