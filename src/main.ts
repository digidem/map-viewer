import "maplibre-gl/dist/maplibre-gl.css";
import pDefer, { type DeferredPromise } from "p-defer";
import maplibregl, { type StyleSpecification } from "maplibre-gl";

// `__BUILD_VERSION__` is set when vite starts the dev server (or at production
// build time). It only changes when you restart vite. We also log a runtime
// stamp on every page load so an HMR refresh / hard refresh is observable.
const LOAD_STAMP = new Date().toISOString().replace("T", " ").slice(0, 19);
console.info(
  `[mbtiles-viewer] build ${__BUILD_VERSION__} · loaded ${LOAD_STAMP}`,
);
(window as unknown as { __APP_VERSION__: string }).__APP_VERSION__ =
  `build ${__BUILD_VERSION__} · loaded ${LOAD_STAMP}`;

// Dump viewport diagnostics to the console too — easier to copy when
// connected via Safari Web Inspector / remote-debug than reading them
// off the on-screen popover. Logged after layout settles.
window.addEventListener("load", () => {
  // One frame later so MapLibre has had a chance to size its canvas.
  requestAnimationFrame(() => {
    console.warn(`[viewport]\n${viewportDiagnostics()}`);
  });
});

import {
  PRESET_STYLES,
  CUSTOM_URL_ATTRIBUTION,
  isTileUrlTemplate,
  rasterStyleForTileUrl,
  type AppStyle,
  type MbtilesStyle,
} from "./preset-styles.ts";
import { BboxMap, type GeoBbox } from "./bbox-map.ts";
import { BoundsPanel } from "./bounds-panel.ts";
import { AttributionButton } from "./attribution-button.ts";
import { HelpButton, viewportDiagnostics } from "./help-button.ts";
import { InstallBanner } from "./install-banner.ts";
import { StylePicker } from "./style-picker.ts";
import { DownloadModal, type DownloadController } from "./download-modal.ts";
import { OverlayPanel } from "./overlay-panel.ts";
import { isGeoJSONFile } from "./overlay-model.ts";
import { layerStyles } from "./layer-styles.ts";
import createProtocolHandler from "./protocol-handler.ts";
import {
  loadRecents,
  loadSelected,
  recentIdForUrl,
  saveSelected,
} from "./recents-store.ts";

// ── Service worker (used for streaming downloads + PWA caching) ───────────
// Hand-rolled registration so we can:
//   - pass `updateViaCache: 'none'`, which makes the browser bypass its 24h
//     HTTP-cache rule for sw.js (the single biggest reason a fresh deploy
//     fails to reach existing users)
//   - poll registration.update() periodically for tabs left open all day
//   - listen for `controllerchange` and reload exactly once after the new
//     SW takes over (in response to our SKIP_WAITING message)
if ("serviceWorker" in navigator) {
  if (import.meta.env.DEV) {
    // Streaming downloads need a SW in dev too; vite-plugin-pwa serves it here
    // (devOptions.enabled). Skip the prod-only update machinery below.
    navigator.serviceWorker
      .register("/dev-sw.js?dev-sw", { type: "module" })
      .catch((err) => console.warn("Dev SW registration failed", err));
  } else {
    registerServiceWorker();
  }
}

async function registerServiceWorker() {
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", {
      type: "module",
      updateViaCache: "none",
    });

    const surfaceWaiting = () => {
      if (reg.waiting) showUpdateBanner(reg.waiting);
    };
    surfaceWaiting();

    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          // A new worker is waiting because an older one still controls us.
          surfaceWaiting();
        }
      });
    });

    // Re-check every 5 min so users with the tab open all day still see
    // updates. .update() is a no-op when nothing has changed.
    setInterval(() => {
      reg.update().catch(() => {});
    }, 5 * 60 * 1000);

    // After we send SKIP_WAITING the new SW activates and the browser
    // swaps controllers; that's our cue to reload exactly once so the page
    // pulls fresh, hashed asset bundles from the new precache.
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  } catch (err) {
    console.warn("SW registration failed", err);
  }
}

function showUpdateBanner(waitingSW: ServiceWorker) {
  if (document.getElementById("update-banner")) return;
  const banner = document.createElement("div");
  banner.id = "update-banner";
  banner.className = "update-banner";
  banner.innerHTML = `
    <span class="update-banner-text">A new version is available.</span>
    <button class="update-banner-btn" type="button">Refresh</button>
    <button class="update-banner-dismiss" type="button" aria-label="Dismiss">×</button>
  `;
  banner
    .querySelector(".update-banner-btn")
    ?.addEventListener("click", () => {
      // Tell the waiting SW to take over. The controllerchange handler above
      // reloads the page once that completes.
      waitingSW.postMessage({ type: "SKIP_WAITING" });
    });
  banner
    .querySelector(".update-banner-dismiss")
    ?.addEventListener("click", () => {
      banner.remove();
    });
  document.body.appendChild(banner);
}

// Tile protocol for the current mbtiles file.
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});
maplibregl.addProtocol("mbtiles", createProtocolHandler(getTileFromWorker));

// ── Worker tile request plumbing (for the mbtiles:// protocol) ────────────
const pendingTileRequests = new Map<number, DeferredPromise<ArrayBuffer>>();
let tileReqId = 0;

worker.addEventListener("message", (event) => {
  const data = event.data;
  if (typeof data?.id === "number" && pendingTileRequests.has(data.id)) {
    const deferred = pendingTileRequests.get(data.id)!;
    pendingTileRequests.delete(data.id);
    if (data.error) deferred.reject(new Error(data.error));
    else deferred.resolve(data.payload);
  }
});

function getTileFromWorker({
  z,
  x,
  y,
}: {
  z: number;
  x: number;
  y: number;
}): Promise<ArrayBuffer> {
  const id = tileReqId++;
  const deferred = pDefer<ArrayBuffer>();
  pendingTileRequests.set(id, deferred);
  worker.postMessage({ type: "tileRequest", payload: { z, x, y }, id });
  return deferred.promise;
}

window.addEventListener("beforeunload", () => {
  worker.postMessage({ type: "beforeunload" });
});

// ── App state ────────────────────────────────────────────────────────────
const mapHost = document.getElementById("map")!;
const overlayHost = document.getElementById("map-overlay")!;

const isMobile = () => window.matchMedia("(max-width: 640px)").matches;
const MOBILE_BOTTOM_INSET = 240;

/** Restore the persisted selection (or fall back to the first preset). mbtiles
 *  selections are not persisted — the underlying file is OPFS-scoped. */
function initialStyle(): AppStyle {
  const ref = loadSelected();
  if (ref?.kind === "preset") {
    const found = PRESET_STYLES.find((p) => p.id === ref.id);
    if (found) return found;
  }
  if (ref?.kind === "recent") {
    const recent = loadRecents().find((r) => r.id === ref.id);
    if (recent) {
      return {
        id: "custom",
        name: recent.name,
        desc: recent.url,
        url: recent.url,
        kind: recent.kind,
        spec: recent.spec,
        accessToken: recent.accessToken,
        maxZoom: recent.maxZoom,
        license: "restrictive",
        attribution: CUSTOM_URL_ATTRIBUTION,
      };
    }
  }
  return PRESET_STYLES[0];
}

let currentStyle: AppStyle = initialStyle();
let currentGeoBbox: GeoBbox | null = null;
let currentMapZoom = 2;

const bboxMap = new BboxMap({
  container: mapHost,
  initialStyle: currentStyle,
  initialCenter: [-0.118, 51.509],
  initialZoom: 10,
  enableResize: !isMobile(),
  bboxColor: "yellow",
  bottomInset: isMobile() ? MOBILE_BOTTOM_INSET : 0,
  onBboxChange: (g) => {
    currentGeoBbox = g;
    boundsPanel.setGeoBbox(g);
  },
  onMapStateChange: ({ zoom }) => {
    currentMapZoom = zoom;
  },
});
(window as any).maplibreMap = bboxMap.map;

// ── Brand chip + help button ──────────────────────────────────────────────
const brand = document.createElement("div");
brand.className = "va-brand";
brand.innerHTML =
  '<img class="va-brand-mark" src="/logo.svg" alt="" /> Map Downloader';
overlayHost.appendChild(brand);

// Top-right controls: attribution "i" stacked above Help in a vertical column.
const topRight = document.createElement("div");
topRight.className = "va-top-right";
overlayHost.appendChild(topRight);

const attribution = new AttributionButton();
const help = new HelpButton();
attribution.init({ onOpen: () => help.close() });
help.init({ onOpen: () => attribution.close() });
topRight.appendChild(attribution.el);
topRight.appendChild(help.el);
attribution.setStyle(currentStyle);

// ── Overlays (GeoJSON layers, desktop only) ───────────────────────────────
// `new` (not createElement) so the import is a value reference the bundler
// keeps, preserving the customElements.define side-effect.
const overlayPanel = new OverlayPanel();
overlayPanel.init({ map: bboxMap.map, isMobile });
overlayHost.appendChild(overlayPanel.el);

// ── Bottom action card ────────────────────────────────────────────────────
const card = document.createElement("div");
card.className = "va-card";
overlayHost.appendChild(card);

const cardRow = document.createElement("div");
cardRow.className = "va-card-row";
card.appendChild(cardRow);

const styleChip = document.createElement("button");
styleChip.id = "style-chip";
styleChip.className = "va-style-chip";
styleChip.innerHTML = `
  <span class="va-style-thumb"></span>
  <span class="va-style-text">
    <span class="va-style-label">Style</span>
    <span class="va-style-name"></span>
  </span>
  <svg class="va-style-chev" width="10" height="10" viewBox="0 0 10 10" fill="none"
    stroke="currentColor" stroke-width="1.5"><path d="M2 4l3 3 3-3" /></svg>`;
cardRow.appendChild(styleChip);

const downloadBtn = document.createElement("button");
downloadBtn.id = "download-button";
downloadBtn.className = "va-download-btn";
downloadBtn.innerHTML = `
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 1v8M3 6l4 4 4-4M2 12h10" />
  </svg>
  Download`;
cardRow.appendChild(downloadBtn);

// When the bounds are locked, the bbox is anchored to these geo coords and
// follows the map on screen; input edits flow straight into the locked extent.
let lockedBounds: GeoBbox | null = null;
const boundsPanel = new BoundsPanel();
boundsPanel.init({
  onApply: (next) => {
    // After an inputs-driven edit, settle the map onto the new bbox the same
    // way a mouse resize does.
    if (lockedBounds) {
      lockedBounds = bboxMap.setLockedGeoBbox(next) ?? next;
      bboxMap.refitToBbox();
      return lockedBounds;
    }
    const result = bboxMap.setGeoBboxExact(next);
    bboxMap.refitToBbox();
    return result;
  },
  getMinGeoSpan: () => bboxMap.getMinGeoSpan(),
  onLock: () => {
    const geo = bboxMap.lockBounds();
    if (!geo) return;
    lockedBounds = geo;
    currentGeoBbox = geo;
    boundsPanel.setLocked(true);
    boundsPanel.setGeoBbox(geo);
  },
  onUnlock: () => {
    bboxMap.unlockAndRefit();
    lockedBounds = null;
    boundsPanel.setLocked(false);
    boundsPanel.collapse();
  },
});
card.appendChild(boundsPanel.el);

function updateStyleChip() {
  const thumb = styleChip.querySelector(".va-style-thumb") as HTMLElement;
  const name = styleChip.querySelector(".va-style-name") as HTMLElement;
  name.textContent = currentStyle.name;
  thumb.style.background = thumbColor(currentStyle.id);
}
updateStyleChip();

function thumbColor(id: string): string {
  const colors: Record<string, string> = {
    positron: "#dadad4",
    liberty: "#cfe2c8",
    bright: "#ffd560",
    dark: "#2a2f3a",
    fiord: "#45516e",
    satellite: "#1a3b5c",
    "esri-clarity": "#1f3a52",
    sentinel2: "#1f2c3a",
    nimbo: "#152a4c",
    "glad-landsat": "#1f2a40",
    topo: "#a8c890",
    "esri-topo": "#cdb98c",
    hillshade: "#bfbfbf",
    "esri-shaded-relief": "#b39764",
    "esri-terrain-base": "#c9d9b0",
    "esri-natgeo": "#d4a86a",
    cyclosm: "#f3eee0",
    humanitarian: "#f6d7c1",
    custom: "#aaa",
    mbtiles: "#e8b070",
  };
  return colors[id] ?? "#ccc";
}

// ── Style picker ──────────────────────────────────────────────────────────
// `new` (not createElement) so the StylePicker import is a value reference —
// otherwise the bundler drops it and its customElements.define side-effect.
const stylePicker = new StylePicker();
stylePicker.init({
  onSelectStyle: (s) => setStyle(s),
  onSelectMbtiles: (file) => loadMbtilesFile(file),
  isMobile,
});
overlayHost.appendChild(stylePicker.el);
styleChip.addEventListener("click", () => {
  const c = bboxMap.map.getCenter();
  stylePicker.open(currentStyle.id, [c.lng, c.lat]);
});

// ── Download modal ────────────────────────────────────────────────────────
const downloadModal = new DownloadModal();
downloadModal.init({
  isMobile,
  onDownload: (req, callbacks) => startDownload(req, callbacks),
});
overlayHost.appendChild(downloadModal.el);
downloadBtn.addEventListener("click", () => {
  // currentGeoBbox is populated as soon as the map first lays out; if a click
  // beats that race, fall back to whatever the map can derive right now.
  const bbox = currentGeoBbox ?? bboxMap.getGeoBbox();
  if (!bbox) return;
  downloadModal.open({
    style: currentStyle,
    geoBbox: bbox,
    currentMapZoom,
  });
});

// ── Style switching ───────────────────────────────────────────────────────
function setStyle(style: AppStyle) {
  currentStyle = style;
  updateStyleChip();
  attribution.setStyle(style);
  bboxMap.setStyle(style);
  persistSelected(style);
}

function persistSelected(style: AppStyle) {
  if ("isMbtiles" in style && style.isMbtiles) {
    // Don't persist mbtiles — OPFS file is gone after reload.
    saveSelected(null);
    return;
  }
  if (style.id.startsWith("qms-")) {
    // QMS styles aren't persisted — the catalogue isn't available at boot.
    saveSelected(null);
    return;
  }
  if (style.id === "custom") {
    saveSelected({ kind: "recent", id: recentIdForUrl(style.url) });
  } else {
    saveSelected({ kind: "preset", id: style.id });
  }
}

// ── MBTiles flow ──────────────────────────────────────────────────────────
async function loadMbtilesFile(file: File) {
  const metaP = new Promise<Record<string, any>>((resolve) => {
    const h = (event: MessageEvent) => {
      if (event.data?.type === "metadata") {
        worker.removeEventListener("message", h);
        resolve(event.data.payload);
      }
    };
    worker.addEventListener("message", h);
  });
  worker.postMessage({ type: "file", payload: file });
  const metadata = await metaP;
  const isVector = metadata.format === "pbf";

  const sources: StyleSpecification["sources"] = {
    mbtiles: {
      type: isVector ? "vector" : "raster",
      tiles: ["mbtiles://./{z}/{x}/{y}"],
      tileSize: isVector ? 512 : 256,
      bounds: metadata.bounds,
      minzoom: metadata.minzoom,
      maxzoom: metadata.maxzoom,
    },
  };

  const layers: StyleSpecification["layers"] = isVector
    ? [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#fafafa" },
        },
        ...layerStyles(metadata.vector_layers || []),
      ]
    : [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#222" },
        },
        { id: "mbtiles", type: "raster", source: "mbtiles" },
      ];

  const spec: StyleSpecification = {
    version: 8,
    sources,
    layers,
  };

  const mbtilesStyle: MbtilesStyle = {
    id: "mbtiles",
    name: file.name,
    desc: "Local .mbtiles file",
    url: "mbtiles://./",
    kind: isVector ? "vector" : "raster",
    isMbtiles: true,
    spec,
    maxZoom:
      typeof metadata.maxzoom === "number" ? metadata.maxzoom : undefined,
    attribution:
      typeof metadata.attribution === "string" && metadata.attribution
        ? metadata.attribution
        : "Local .mbtiles file.",
    license: "open",
  };
  setStyle(mbtilesStyle);
  if (Array.isArray(metadata.bounds) && metadata.bounds.length === 4) {
    bboxMap.fitBounds(
      [
        [metadata.bounds[0], metadata.bounds[1]],
        [metadata.bounds[2], metadata.bounds[3]],
      ],
      false,
    );
  }
}

// ── Download orchestration ────────────────────────────────────────────────
function startDownload(
  req: {
    style: AppStyle;
    bbox: GeoBbox;
    maxZoom: number;
    name: string;
    description: string;
  },
  callbacks: {
    onProgress: (p: { fraction: number; done?: boolean }) => void;
    onError: (msg: string) => void;
  },
): DownloadController {
  let cancelled = false;
  const fileName =
    (req.name.replace(/[^a-z0-9-_ ]/gi, "_").trim() || "map") + ".smp";

  (async () => {
    try {
      // Build progress + completion handlers attached to the worker.
      const onComplete = waitForSmpComplete(
        (fraction) => {
          if (!cancelled) callbacks.onProgress({ fraction });
        },
        (err) => {
          if (!cancelled) callbacks.onError(err);
        },
      );

      const channel = await prepareSwDownload(fileName);
      const style = req.style;
      if ("isMbtiles" in style && style.isMbtiles) {
        worker.postMessage(
          { type: "generateSmpFromMbtiles", port: channel.workerPort },
          [channel.workerPort],
        );
      } else {
        const accessToken =
          "accessToken" in style ? style.accessToken : undefined;
        const message: any = {
          type: "generateSmpFromStyle",
          port: channel.workerPort,
          bbox: [
            req.bbox.west,
            req.bbox.south,
            req.bbox.east,
            req.bbox.north,
          ],
          maxZoom: req.maxZoom,
          accessToken,
        };
        const inlineSpec = "spec" in style && style.spec ? style.spec : null;
        if (inlineSpec) {
          message.styleSpec = inlineSpec;
        } else if (isTileUrlTemplate(style.url)) {
          // Tile URL template — wrap into a basic raster style, carrying the
          // source's subdomains, tile scheme (xyz/tms) and native max zoom to
          // the downloader so it never fetches overzoomed tiles.
          message.styleSpec = rasterStyleForTileUrl(
            style.url,
            "subdomains" in style ? style.subdomains : undefined,
            "scheme" in style ? style.scheme : undefined,
            "maxZoom" in style ? style.maxZoom : undefined,
          );
        } else {
          message.styleUrl = style.url;
        }
        worker.postMessage(message, [channel.workerPort]);
      }

      await onComplete;
      if (!cancelled) callbacks.onProgress({ fraction: 1, done: true });
    } catch (err) {
      if (!cancelled) callbacks.onError((err as Error).message);
    }
  })();

  return {
    cancel() {
      cancelled = true;
    },
  };
}

interface SwDownloadChannel {
  workerPort: MessagePort;
}

/** Bind a download URL in the service worker, return the worker-side port. */
async function prepareSwDownload(fileName: string): Promise<SwDownloadChannel> {
  const sw = await navigator.serviceWorker?.getRegistration();
  if (!sw?.active) throw new Error("Service worker not available");
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

  // Trigger the browser download by navigating a hidden iframe to the URL.
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.src = sw.scope + encodedName;
  document.body.appendChild(iframe);

  return { workerPort: channel.port2 };
}

function waitForSmpComplete(
  onProgress: (fraction: number) => void,
  onError: (msg: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === "smpProgress") {
        onProgress(data.fraction);
      } else if (data.type === "smpComplete") {
        worker.removeEventListener("message", handler);
        resolve();
      } else if (data.type === "smpError") {
        worker.removeEventListener("message", handler);
        onError(data.error);
        reject(new Error(data.error));
      }
    };
    worker.addEventListener("message", handler);
  });
}

// ── Drag-drop mbtiles anywhere ────────────────────────────────────────────
const dropOverlay = document.getElementById("drop-overlay")!;
let dragCounter = 0;

document.addEventListener("dragenter", (e) => {
  if (isMobile()) return;
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) dropOverlay.classList.remove("hidden");
});
document.addEventListener("dragover", (e) => {
  if (isMobile()) return;
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (e) => {
  if (isMobile()) return;
  e.preventDefault();
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) dropOverlay.classList.add("hidden");
});
document.addEventListener("drop", (e) => {
  if (isMobile()) return;
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.add("hidden");
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  // GeoJSON files become overlays; an .mbtiles file replaces the basemap.
  const geojson = Array.from(files).filter(isGeoJSONFile);
  if (geojson.length > 0) {
    void overlayPanel.addFiles(geojson);
    return;
  }
  const mbtiles = Array.from(files).find((f) =>
    /\.(mbtiles|sqlite|sqlite3|db)$/i.test(f.name),
  );
  if (mbtiles) loadMbtilesFile(mbtiles);
});

// ── Resize re-evaluation (mobile vs desktop transitions) ──────────────────
window.addEventListener("resize", () => {
  bboxMap.setBottomInset(isMobile() ? MOBILE_BOTTOM_INSET : 0);
  overlayPanel.setMobile(isMobile());
});

// ── PWA install hint ──────────────────────────────────────────────────────
// Renders a one-time card-shaped banner at the bottom of the screen, sitting
// over the action card so iOS users (where there's no programmatic install
// path) see the affordance immediately. Dismissal persists; the help popover
// keeps a permanent entry for users who change their mind.
const installBanner = new InstallBanner();
overlayHost.appendChild(installBanner.el);
