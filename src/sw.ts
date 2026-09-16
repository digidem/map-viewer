import { precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

// --- Streaming download support ---
// Based on the pattern from native-file-system-adapter.
// The main thread sends a MessagePort + URL to the SW. The SW reconstructs
// a ReadableStream from the port and responds to a fetch for that URL with
// the stream, triggering a browser download via Content-Disposition.

const WRITE = 0;
const PULL = 0;
const ERROR = 1;
const CLOSE = 2;

class MessagePortSource implements UnderlyingDefaultSource<Uint8Array> {
  controller!: ReadableStreamDefaultController<Uint8Array>;
  port: MessagePort;

  constructor(port: MessagePort) {
    this.port = port;
    this.port.onmessage = (evt) => this.onMessage(evt.data);
  }

  start(controller: ReadableStreamDefaultController<Uint8Array>) {
    this.controller = controller;
  }

  pull() {
    this.port.postMessage({ type: PULL });
  }

  cancel(reason: any) {
    this.port.postMessage({ type: ERROR, reason: String(reason) });
    this.port.close();
  }

  onMessage(message: { type: number; chunk?: Uint8Array; reason?: any }) {
    if (message.type === WRITE) {
      this.controller.enqueue(message.chunk!);
    } else if (message.type === ERROR) {
      this.controller.error(message.reason);
      this.port.close();
    } else if (message.type === CLOSE) {
      this.controller.close();
      this.port.close();
    }
  }
}

type Download = {
  rs: ReadableStream<Uint8Array>;
  headers: Record<string, string>;
};

const DOWNLOAD_PATH = "/_download/";
const DOWNLOAD_TIMEOUT = 30_000;

const pending = new Map<string, Download>();
const waiting = new Map<string, (download: Download) => void>();

self.addEventListener("message", (evt) => {
  const data = evt.data;
  if (!data?.url || !data.readablePort) return;
  const rs = new ReadableStream(
    new MessagePortSource(data.readablePort),
    new CountQueuingStrategy({ highWaterMark: 4 }),
  );
  const download = { rs, headers: data.headers };
  const waiter = waiting.get(data.url);
  if (waiter) {
    waiting.delete(data.url);
    waiter(download);
  } else {
    pending.set(data.url, download);
  }
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const ready = pending.get(url);
  if (ready) {
    pending.delete(url);
    event.respondWith(new Response(ready.rs, { headers: ready.headers }));
    return;
  }
  if (!new URL(url).pathname.startsWith(DOWNLOAD_PATH)) return;
  // The page navigates here synchronously to keep Safari's user activation, and
  // sends the stream just after, so hold the request open until it arrives
  event.respondWith(
    new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(url);
        resolve(new Response("Download expired", { status: 504 }));
      }, DOWNLOAD_TIMEOUT);
      waiting.set(url, (download) => {
        clearTimeout(timer);
        resolve(new Response(download.rs, { headers: download.headers }));
      });
    }),
  );
});
