import "maplibre-gl/dist/maplibre-gl.css";
import "@fontsource/hanken-grotesk/latin-400.css";
import "@fontsource/hanken-grotesk/latin-600.css";
import "@fontsource/hanken-grotesk/latin-700.css";
import pDefer, { type DeferredPromise } from "p-defer";
import { includeKeys } from "filter-obj";
import createProtocolHandler from "./protocol-handler.ts";
import { pEvent } from "p-event";
// Type-only: maplibre-gl itself is loaded lazily via import() below, keeping it out of the entry chunk
import type {
  IControl,
  LngLatBoundsLike,
  Map as MaplibreMap,
  StyleSpecification,
} from "maplibre-gl";
import { layerStyles } from "./layer-styles.ts";

type OpenedFile =
  | { kind: "mbtiles"; fileName: string; metadata: Record<string, any> }
  | { kind: "smp"; fileName: string; style: StyleSpecification };

// Register service worker for PWA + streaming downloads
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(
      import.meta.env.MODE === "production" ? "/sw.js" : "/dev-sw.js?dev-sw",
      {
        type: import.meta.env.MODE === "production" ? "classic" : "module",
        // Without this a cached sw.js can keep an old worker alive for a day,
        // and downloads break against a worker that predates them
        updateViaCache: "none",
      },
    )
    .then((registration) => registration.update())
    .catch(() => {});
}

// PWA Install Guidance
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && (navigator as any).standalone);

if (!isStandalone) {
  const installGuide = document.getElementById("install-guide");
  const installButton = document.getElementById(
    "install-button"
  ) as HTMLButtonElement;
  const installIos = document.getElementById("install-ios");

  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as any).MSStream;

  let deferredPrompt: any = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installGuide?.classList.remove("hidden");
    installButton?.classList.remove("hidden");
  });

  installButton?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    deferredPrompt = null;
    installButton.classList.add("hidden");
    installGuide?.classList.add("hidden");
  });

  if (isIos) {
    installGuide?.classList.remove("hidden");
    installIos?.classList.remove("hidden");
  }
}

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

class Api {
  #id = 0;
  #worker: Worker;
  #pendingRequests = new Map<number, DeferredPromise<ArrayBuffer>>();
  constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener("message", this.#handleMessage);
  }
  #handleMessage = (event: MessageEvent<any>) => {
    const pending = this.#pendingRequests.get(event.data.id);
    if (!pending) return;
    this.#pendingRequests.delete(event.data.id);
    if (event.data.error) {
      pending.reject(new Error(event.data.error));
    } else {
      pending.resolve(event.data.payload);
    }
  };
  async getResource(url: string) {
    const requestId = this.#id++;
    const deferred = pDefer<ArrayBuffer>();
    this.#pendingRequests.set(requestId, deferred);
    this.#worker.postMessage({
      type: "resourceRequest",
      payload: { url },
      id: requestId,
    });
    return deferred.promise;
  }
}

const api = new Api(worker);

const input = document.getElementById("file-input") as HTMLInputElement;
const button = document.getElementById("open-button") as HTMLButtonElement;
const spinner = document.getElementById("spinner") as HTMLDivElement;
const dropHint = document.getElementById("drop-hint") as HTMLParagraphElement;
const dropOverlay = document.getElementById("drop-overlay") as HTMLDivElement;
const openError = document.getElementById("open-error") as HTMLParagraphElement;

button?.addEventListener("click", async () => {
  input?.click();
});

input?.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  openFile(file);
  input.value = "";
});

let opening = false;

function openFile(file: File) {
  // The picker is disabled while opening, but drops are not
  if (opening) return;
  opening = true;
  openError?.classList.add("hidden");
  setInProgress(true);
  worker.postMessage({ type: "file", payload: file });
}

worker.addEventListener("message", (event) => {
  if (event.data.type === "opened") opening = false;
  if (event.data.type === "openError") showOpenError(event.data.error);
});

function showOpenError(message: string) {
  opening = false;
  if (openError) {
    openError.textContent = message;
    openError.classList.remove("hidden");
  }
  setInProgress(false);
}

// Drag-and-drop support
let dragCounter = 0;
let mapVisible = false;

document.addEventListener("dragenter", (e) => {
  if (mapVisible) return;
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) {
    dropOverlay?.classList.remove("hidden");
  }
});

document.addEventListener("dragover", (e) => {
  if (mapVisible) return;
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = "copy";
  }
});

document.addEventListener("dragleave", (e) => {
  if (mapVisible) return;
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    dropOverlay?.classList.add("hidden");
  }
});

document.addEventListener("drop", (e) => {
  if (mapVisible) return;
  e.preventDefault();
  dragCounter = 0;
  dropOverlay?.classList.add("hidden");
  const file = e.dataTransfer?.files?.[0];
  if (file) {
    openFile(file);
  }
});

setInProgress(false);

function setInProgress(inProgress: boolean) {
  if (inProgress) {
    input?.setAttribute("disabled", "true");
    button?.setAttribute("disabled", "true");
    spinner?.classList.remove("hidden");
    button?.classList.add("hidden");
    dropHint?.classList.add("hidden");
  } else {
    input?.removeAttribute("disabled");
    spinner?.classList.add("hidden");
    button?.classList.remove("hidden");
    button?.removeAttribute("disabled");
    dropHint?.classList.remove("hidden");
  }
}

window.addEventListener("beforeunload", () => {
  worker.postMessage({ type: "beforeunload" });
});

pEvent<"message", MessageEvent<any>>(
  worker,
  "message",
  (event) => event.data.type === "opened"
).then(async ({ data: { payload } }: { data: { payload: OpenedFile } }) => {
  const map = await mapPromise;
  const { NavigationControl } = await import("maplibre-gl");
  map.addControl(
    new NavigationControl({
      showCompass: false,
    }),
    "top-right"
  );
  if (payload.kind === "mbtiles") {
    map.addControl(
      new SaveControl({ fileName: payload.fileName }),
      "top-right"
    );
  }
  map.addControl(
    new CloseControl(() => {
      window.location.reload();
    }),
    "top-left"
  );

  if (payload.kind === "smp") {
    showSmp(map, payload.style);
  } else {
    showMbtiles(map, payload.metadata);
  }
  map.on("sourcedata", () => {
    if (mapVisible) return;
    map.getContainer().classList.remove("hidden");
    mapVisible = true;
    // The map covers the landing page, but its buttons would still be reachable by keyboard
    for (const el of document.querySelectorAll<HTMLElement>(
      ".mv-landing, #install-guide"
    )) {
      el.inert = true;
    }
  });
});

function showMbtiles(map: MaplibreMap, metadata: Record<string, any>) {
  if (metadata.format === "pbf") {
    map.addSource("mbtiles", {
      ...includeKeys(metadata, ["bounds", "center", "minzoom", "maxzoom"]),
      type: "vector",
      tiles: ["mbtiles://./{z}/{x}/{y}"],
    });
    for (const layerStyle of layerStyles(
      metadata.vector_layers || [],
      "mbtiles"
    )) {
      map.addLayer(layerStyle);
    }
  } else {
    map.addSource("mbtiles", {
      ...includeKeys(metadata, ["bounds", "center", "minzoom", "maxzoom"]),
      type: "raster",
      tiles: ["mbtiles://./{z}/{x}/{y}"],
      tileSize: 256,
    });
    map.addLayer({
      id: "mbtiles",
      type: "raster",
      source: "mbtiles",
    });
  }
  map.fitBounds(metadata.bounds, { duration: 0 });
}

function coversWorld([w, s, e, n]: [number, number, number, number]) {
  return w <= -179 && e >= 179 && s <= -84 && n >= 84;
}

function showSmp(map: MaplibreMap, smpStyle: StyleSpecification) {
  let styleLoaded = false;
  // MapLibre skips style.load (and so never reveals the map) if it rejects the style
  map.once("error", ({ error }) => {
    if (!styleLoaded) showOpenError(`Could not display this map: ${error.message}`);
  });
  map.setStyle(smpStyle, { diff: false });
  map.once("style.load", () => {
    styleLoaded = true;
    const bounds: [number, number, number, number] | undefined = (
      smpStyle.metadata as any
    )?.["smp:bounds"];
    // A worldwide package has nothing useful to outline, and fitting it zooms
    // out past the style's own view
    if (!bounds || coversWorld(bounds)) {
      map.jumpTo({ center: smpStyle.center, zoom: smpStyle.zoom });
      return;
    }
    const [w, s, e, n] = bounds;
    map.addSource("smp-bounds", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
        },
      },
    });
    map.addLayer({
      id: "smp-bounds",
      type: "line",
      source: "smp-bounds",
      paint: {
        "line-color": "#1854f6",
        "line-width": 2,
        "line-dasharray": [2, 2],
      },
    });
    map.fitBounds(bounds as LngLatBoundsLike, { duration: 0 });
  });
}

const style: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#222",
      },
    },
  ],
};

const mapPromise = pEvent(window, "load")
  .then(() =>
    Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    ])
  )
  .then(([maplibre, { default: maplibreWorkerUrl }]) => {
    // maplibre-gl 6 otherwise resolves its worker to a path Vite doesn't emit
    maplibre.setWorkerUrl(maplibreWorkerUrl);
    const protocolHandler = createProtocolHandler(api.getResource.bind(api));
    maplibre.addProtocol("mbtiles", protocolHandler);
    maplibre.addProtocol("smp", protocolHandler);
    const map = new maplibre.Map({
      container: "map",
      center: [0, 0],
      style,
      zoom: 2,
      attributionControl: false,
      dragRotate: false,
    });
    // Expose for e2e tests
    (window as any).maplibreMap = map;
    return map;
  });

// --- Streaming download ---
// Creates a MessageChannel whose ports connect the web worker directly to the
// service worker. Data flows worker → MessagePort → SW → browser download,
// without passing through the main thread. Based on the pattern from
// native-file-system-adapter by jimmywarting.

/** Wait for the worker to signal SMP generation is complete */
function waitForSmpComplete(): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === "smpComplete") {
        worker.removeEventListener("message", handler);
        resolve();
      } else if (event.data.type === "smpError") {
        worker.removeEventListener("message", handler);
        reject(new Error(event.data.error));
      }
    };
    worker.addEventListener("message", handler);
  });
}

// Kept in step with sw.ts: an older service worker ignores /_download/ requests
const DOWNLOAD_PROTOCOL = 2;

/** Ask the active service worker which download protocol it speaks (0 = none) */
function downloadProtocol(registration: ServiceWorkerRegistration) {
  return new Promise<number>((resolve) => {
    const sw = registration.active;
    if (!sw) return resolve(0);
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(0), 1000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.downloadProtocol ?? 0);
    };
    sw.postMessage({ type: "ping" }, [channel.port2]);
  });
}

/** A worker installed before downloads existed silently ignores them, and the
 * page only finds out when a download fails, so replace it up front */
async function ensureDownloadWorker() {
  const registration = await navigator.serviceWorker?.ready;
  if (!registration) return;
  if ((await downloadProtocol(registration)) >= DOWNLOAD_PROTOCOL) return;
  await registration.update().catch(() => {});
}

void ensureDownloadWorker();

/** Resolves once the service worker reports it received the download request */
function waitForDownloadStart(url: string, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (started: boolean) => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve(started);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "downloadStarted" && event.data.url === url) {
        finish(true);
      }
    };
    const timer = setTimeout(() => finish(false), timeout);
    navigator.serviceWorker.addEventListener("message", onMessage);
  });
}

/** Stream the package through the service worker, so the browser writes it to
 * disk as it arrives and nothing is held in memory */
async function startSmpDownload(fileName: string) {
  if (!navigator.serviceWorker?.controller) {
    throw new Error(
      "Downloads need the service worker — reload the page and try again",
    );
  }

  const encodedName = encodeURIComponent(fileName)
    .replace(
      /['()]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    .replace(/\*/g, "%2A");
  const url = `${location.origin}/_download/${crypto.randomUUID()}/${encodedName}`;

  // Navigate first and synchronously: Safari only starts a download while the
  // click's user activation is live. The service worker holds the request open
  // until the stream below reaches it.
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.src = url;
  document.body.appendChild(iframe);

  // Nothing is generated until the request is known to have arrived
  if (!(await waitForDownloadStart(url, 5000))) {
    iframe.remove();
    throw new Error(
      "The service worker did not receive the download request — reload the page and try again",
    );
  }

  const headers = {
    // Safari ignores filename*, so send a plain ASCII filename as well
    "content-disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodedName}`,
    "content-type": "application/octet-stream",
  };

  const done = waitForSmpComplete();
  const channel = new MessageChannel();
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ url, headers, readablePort: channel.port1 }, [
    channel.port1,
  ]);
  worker.postMessage(
    { type: "generateSmp", port: channel.port2 },
    [channel.port2],
  );

  try {
    await done;
  } finally {
    iframe.remove();
  }
}

class CloseControl implements IControl {
  #container: HTMLDivElement | undefined;
  #onClick: (ev: MouseEvent) => void;

  constructor(onClick: (ev: MouseEvent) => void) {
    this.#onClick = onClick;
  }
  onAdd() {
    this.#container = document.createElement("div");
    this.#container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.className = "maplibregl-ctrl-icon";
    button.title = "Close";
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-[17px] h-[17px] m-[6px]"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
    button.onclick = this.#onClick;
    this.#container.appendChild(button);
    return this.#container;
  }

  onRemove() {
    this.#container?.parentNode?.removeChild(this.#container);
  }
}

class SaveControl implements IControl {
  #container: HTMLDivElement | undefined;
  #fileName: string;

  constructor({ fileName }: { fileName: string }) {
    this.#fileName = fileName;
  }

  onAdd() {
    this.#container = document.createElement("div");
    this.#container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.id = "download-smp";
    btn.className =
      "maplibregl-ctrl-icon block w-[29px] h-[29px] cursor-pointer border-0 bg-transparent p-0";
    btn.title = "Download as SMP";
    const downloadIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[19px] h-[19px] m-[5px]"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const spinnerIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-[19px] h-[19px] m-[5px] animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
    btn.innerHTML = downloadIcon;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerHTML = spinnerIcon;
      try {
        const smpFileName =
          this.#fileName.replace(/\.[^.]+$/, "") + ".smp";
        await startSmpDownload(smpFileName);
      } catch (err) {
        console.error("SMP download failed:", err);
      } finally {
        btn.disabled = false;
        btn.innerHTML = downloadIcon;
      }
    });
    this.#container.appendChild(btn);
    return this.#container;
  }

  onRemove() {
    this.#container?.parentNode?.removeChild(this.#container);
  }
}
