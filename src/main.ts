import "maplibre-gl/dist/maplibre-gl.css";
import pDefer, { type DeferredPromise } from "p-defer";
import { includeKeys } from "filter-obj";
import createProtocolHandler from "./protocol-handler.ts";
import { pEvent } from "p-event";
// Type-only: maplibre-gl itself is loaded lazily via import() below, keeping it out of the entry chunk
import type { IControl, StyleSpecification } from "maplibre-gl";
import { layerStyles } from "./layer-styles.ts";

// Register service worker for PWA + streaming downloads
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(
    import.meta.env.MODE === "production" ? "/sw.js" : "/dev-sw.js?dev-sw",
    { type: import.meta.env.MODE === "production" ? "classic" : "module" },
  );
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
  #pendingTileRequests = new Map<number, DeferredPromise<ArrayBuffer>>();
  constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener("message", this.#handleMessage);
  }
  #handleMessage = (event: MessageEvent<any>) => {
    const pending = this.#pendingTileRequests.get(event.data.id);
    if (!pending) return;
    this.#pendingTileRequests.delete(event.data.id);
    if (event.data.error) {
      pending.reject(new Error(event.data.error));
    } else {
      pending.resolve(event.data.payload);
    }
  };
  async getTile({ z, x, y }: { z: number; x: number; y: number }) {
    const requestId = this.#id++;
    const deferred = pDefer<ArrayBuffer>();
    this.#pendingTileRequests.set(requestId, deferred);
    this.#worker.postMessage({
      type: "tileRequest",
      payload: { z, x, y },
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

button?.addEventListener("click", async () => {
  input?.click();
});

input?.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  openFile(file);
});

function openFile(file: File) {
  setInProgress(true);
  worker.postMessage({ type: "file", payload: file });
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
  (event) => event.data.type === "metadata"
).then(async ({ data: { payload: metadata } }) => {
  const map = await mapPromise;
  const { NavigationControl } = await import("maplibre-gl");
  map.addControl(
    new NavigationControl({
      showCompass: false,
    }),
    "top-right"
  );
  map.addControl(
    new SaveControl({ fileName: metadata.fileName }),
    "top-right"
  );
  map.addControl(
    new CloseControl(() => {
      window.location.reload();
    }),
    "top-left"
  );

  if (metadata.format === "pbf") {
    map.addSource("mbtiles", {
      ...includeKeys(metadata, ["bounds", "center", "minzoom", "maxzoom"]),
      type: "vector",
      tiles: ["mbtiles://./{z}/{x}/{y}"],
    });
    for (const layerStyle of layerStyles(metadata.vector_layers || [])) {
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
  map.on("sourcedata", () => {
    map.getContainer().classList.remove("hidden");
    mapVisible = true;
  });
});

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
    maplibre.addProtocol(
      "mbtiles",
      createProtocolHandler(api.getTile.bind(api))
    );
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

/** Start SMP generation in the worker, streaming result to a download */
async function startSmpDownload(fileName: string) {
  const done = waitForSmpComplete();

  const sw = await navigator.serviceWorker?.getRegistration();
  if (!sw?.active) {
    throw new Error("Service worker not available for download");
  }

  const channel = new MessageChannel();
  const encodedName = encodeURIComponent(fileName)
    .replace(
      /['()]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    .replace(/\*/g, "%2A");

  const headers = {
    "content-disposition": "attachment; filename*=UTF-8''" + encodedName,
    "content-type": "application/octet-stream",
  };

  sw.active.postMessage(
    { url: sw.scope + encodedName, headers, readablePort: channel.port1 },
    [channel.port1],
  );

  worker.postMessage(
    { type: "generateSmp", port: channel.port2 },
    [channel.port2],
  );

  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.src = sw.scope + encodedName;
  document.body.appendChild(iframe);

  await done;
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
    button.textContent = "\u2716\uFE0F";
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
