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

const pending = new Map<
  string,
  { rs: ReadableStream<Uint8Array>; headers: Record<string, string> }
>();

self.addEventListener("message", (evt) => {
  const data = evt.data;
  if (data.url && data.readablePort) {
    const rs = new ReadableStream(
      new MessagePortSource(data.readablePort),
      new CountQueuingStrategy({ highWaterMark: 4 }),
    );
    pending.set(data.url, { rs, headers: data.headers });
  }
});

self.addEventListener("fetch", (event) => {
  const data = pending.get(event.request.url);
  if (!data) return;
  pending.delete(event.request.url);
  event.respondWith(new Response(data.rs, { headers: data.headers }));
});
