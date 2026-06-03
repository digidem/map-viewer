import { html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { LightElement } from "./lit-base.ts";

/** Browser-fired beforeinstallprompt event (Chromium-only). The DOM lib types
 *  don't include it, so we model the bits we touch. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator &&
    (navigator as { standalone?: boolean }).standalone === true);

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as unknown as { MSStream?: unknown }).MSStream;

export interface HelpButtonOptions {
  /** Fired when the popover opens — lets the host close sibling popovers. */
  onOpen?: () => void;
}

export class HelpButton extends LightElement {
  static properties = {
    open: { state: true },
    deferredPrompt: { state: true },
  };

  declare open: boolean;
  /** Stashed beforeinstallprompt event so the user can install on demand. */
  declare deferredPrompt: BeforeInstallPromptEvent | null;

  private opts: HelpButtonOptions = {};

  constructor() {
    super();
    this.open = false;
    this.deferredPrompt = null;

    // Capture the install prompt for Chromium so the help-popover Install
    // button can surface it on-demand. iOS doesn't fire this event — there
    // we fall back to the visual Add-to-Home-Screen instructions.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
    });
    // After a successful install, drop the prompt so we stop offering it.
    window.addEventListener("appinstalled", () => {
      this.deferredPrompt = null;
    });
  }

  /** Inject runtime options. Custom-element constructors take no arguments. */
  init(opts: HelpButtonOptions = {}): this {
    this.opts = opts;
    return this;
  }

  get el(): this {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("help-root");
  }

  close() {
    this.open = false;
  }

  private toggle() {
    if (this.open) {
      this.open = false;
    } else {
      this.opts.onOpen?.();
      this.open = true;
    }
  }

  private async runInstall() {
    const dp = this.deferredPrompt;
    if (!dp) return;
    await dp.prompt();
    const { outcome } = await dp.userChoice;
    if (outcome === "accepted") this.deferredPrompt = null;
    this.close();
  }

  render() {
    return html`
      <button
        class=${classMap({ "help-btn": true, "help-btn-active": this.open })}
        aria-label="Help"
        @click=${() => this.toggle()}
      >
        <!-- Material Symbols "help" (filled). viewBox is Material's 960-grid. -->
        <svg width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
          <path d="M513.5-254.5Q528-269 528-290t-14.5-35.5Q499-340 478-340t-35.5 14.5Q428-311 428-290t14.5 35.5Q457-240 478-240t35.5-14.5ZM442-394h74q0-33 7.5-52t42.5-52q26-26 41-49.5t15-56.5q0-56-41-86t-97-30q-57 0-92.5 30T342-618l66 26q5-18 22.5-39t53.5-21q32 0 48 17.5t16 38.5q0 20-12 37.5T506-526q-44 39-54 59t-10 73Zm38 314q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" />
        </svg>
      </button>
      ${this.open ? this.renderPopover() : nothing}
    `;
  }

  private renderPopover(): TemplateResult {
    const version =
      (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ ??
      `build ${__BUILD_VERSION__}`;
    return html`
      <div class="help-popover-wrap" @click=${() => this.close()}>
        <div class="help-popover" @click=${(e: Event) => e.stopPropagation()}>
          <div class="help-popover-header">
            <div class="help-popover-title">About this tool</div>
            <button
              class="help-popover-close"
              aria-label="Close"
              @click=${() => this.close()}
            >×</button>
          </div>
          <p>
            Pick a region of the world and download its map tiles for
            <b>offline use</b> — useful for fieldwork, hiking, or low-bandwidth
            environments.
          </p>
          <div class="help-stepper">
            <div class="help-step">
              <div class="help-step-num">1</div>
              <div class="help-step-text">
                Pan and zoom the map to the area you want.
              </div>
            </div>
            <div class="help-step">
              <div class="help-step-num">2</div>
              <div class="help-step-text">
                Drag the bbox handles to fine-tune the region, or type bounds
                directly.
              </div>
            </div>
            <div class="help-step">
              <div class="help-step-num">3</div>
              <div class="help-step-text">
                Click <b>Download</b> to choose a max zoom and save the
                package.
              </div>
            </div>
          </div>
          <div class="help-popover-tip">
            Tip: smaller area + lower max zoom = smaller download.
          </div>
          <div class="help-popover-version">${version}</div>
          ${this.renderInstallSection()}
        </div>
      </div>
    `;
  }

  /** The install section, or `nothing` if installation isn't applicable
   *  (already in standalone mode, or a desktop browser without a deferred
   *  install prompt). */
  private renderInstallSection(): TemplateResult | typeof nothing {
    if (isStandalone()) return nothing;
    const ios = isIos();
    if (!ios && !this.deferredPrompt) return nothing;
    if (ios) {
      return html`
        <div class="help-install">
          <div class="help-install-title">Install to home screen</div>
          <p>
            Tap
            <svg class="help-install-icon" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            in Safari then <b>Add to Home Screen</b> for full-screen,
            offline-ready use.
          </p>
        </div>
      `;
    }
    return html`
      <div class="help-install">
        <div class="help-install-title">Install as an app</div>
        <p>Add this tool to your device for full-screen, offline-ready use.</p>
        <button
          class="help-install-btn"
          type="button"
          @click=${() => this.runInstall()}
        >
          Install
        </button>
      </div>
    `;
  }
}

if (!customElements.get("help-button")) {
  customElements.define("help-button", HelpButton);
}

/** Dumps every viewport-y measurement we know about. Both the help popover
 *  and main.ts boot-time logger use this so the data on a remote device is
 *  consistent across the on-screen display and the JS console. */
export function viewportDiagnostics(): string {
  const screen = window.screen;
  const dpr = window.devicePixelRatio;
  const app = document.getElementById("app");
  const canvas = document.querySelector<HTMLCanvasElement>("#map canvas");
  const root = document.documentElement;
  const appRect = app?.getBoundingClientRect();
  const canvasRect = canvas?.getBoundingClientRect();
  const lines = [
    `screen ${screen.width}×${screen.height} @${dpr}x`,
    `window.inner ${window.innerWidth}×${window.innerHeight}`,
    `window.outer ${window.outerWidth}×${window.outerHeight}`,
    `docEl.client ${root.clientWidth}×${root.clientHeight}`,
    `100vh=${probeUnit("100vh")} 100lvh=${probeUnit("100lvh")} 100svh=${probeUnit("100svh")} 100dvh=${probeUnit("100dvh")}`,
    `safe inset T=${getSafeInset("top")} R=${getSafeInset("right")} B=${getSafeInset("bottom")} L=${getSafeInset("left")}`,
    `#app rect ${appRect ? `${appRect.left.toFixed(0)},${appRect.top.toFixed(0)} ${appRect.width.toFixed(0)}×${appRect.height.toFixed(0)}` : "?"}`,
    `canvas rect ${canvasRect ? `${canvasRect.left.toFixed(0)},${canvasRect.top.toFixed(0)} ${canvasRect.width.toFixed(0)}×${canvasRect.height.toFixed(0)}` : "?"}`,
    `standalone=${isStandalone()}`,
  ];
  return lines.join("\n");
}

function probeUnit(unit: string): number {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.height = unit;
  el.style.width = "1px";
  document.body.appendChild(el);
  const h = el.offsetHeight;
  el.remove();
  return h;
}

/** Read a CSS env() value as a pixel number (or 0 if unsupported). */
function getSafeInset(side: "top" | "right" | "bottom" | "left"): number {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.height = `env(safe-area-inset-${side})`;
  el.style.width = "1px";
  document.body.appendChild(el);
  const h = el.offsetHeight;
  el.remove();
  return h;
}
