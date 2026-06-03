import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Stamp the build moment into the bundle so a device on the network can
// confirm what it's running. In dev this is the vite-server start time; in a
// production build it's the build time. Reset by restarting vite or rebuilding.
const BUILD_VERSION = new Date()
  .toISOString()
  .replace("T", " ")
  .slice(0, 19);

// Mirror of the Cloudflare Pages `_headers` rules for vite preview/dev so a
// freshly-built sw.js bypasses the browser's 24-hour update rule.
const noCacheForServiceWorker = {
  name: "no-cache-for-sw",
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? "";
      if (
        url === "/sw.js" ||
        url === "/registerSW.js" ||
        url === "/index.html" ||
        url === "/"
      ) {
        res.setHeader("Cache-Control", "no-cache");
      }
      next();
    });
  },
};

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
  worker: {
    format: "es",
  },
  server: {
    headers: {
      // `credentialless` keeps SharedArrayBuffer + OPFS available while still
      // allowing cross-origin resources (tile servers, preset preview tiles)
      // that don't send CORP/CORS — they're loaded without credentials.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  optimizeDeps: {
    exclude: ["mbtiles-reader", "@sqlite.org/sqlite-wasm"],
    // mbtiles-reader is excluded (so sqlite-wasm keeps its real import.meta.url
    // for locating sqlite3.wasm + the OPFS proxy), which also leaves its
    // CommonJS sub-dep @mapbox/tiletype unconverted. Force it through dep
    // optimization so the worker can load it as ESM in dev.
    include: ["@mapbox/tiletype"],
  },
  plugins: [
    noCacheForServiceWorker,
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: false,
      injectManifest: {
        rollupFormat: "es",
      },
      devOptions: {
        // Serve the SW under `npm run dev` so streaming SMP downloads work in
        // development — they pipe through the service worker, not just in prod.
        enabled: true,
        type: "module",
      },
      manifest: {
        name: "MBTiles Viewer",
        short_name: "MBTiles",
        theme_color: "#eef2ff",
        background_color: "#eef2ff",
        icons: [
          {
            src: "pwa-64x64.png",
            sizes: "64x64",
            type: "image/png",
          },
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
