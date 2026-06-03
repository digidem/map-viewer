import { html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { LightElement } from "./lit-base.ts";
import {
  getRestrictions,
  LICENSE_COLORS,
  LICENSE_LABELS,
  USAGE_ASPECT_LABELS,
  USAGE_ASPECTS,
  VERDICT_COLORS,
  VERDICT_LABELS,
  type AppStyle,
} from "./preset-styles.ts";

export interface AttributionButtonOptions {
  /** Fired when the popover opens — lets the host close sibling popovers. */
  onOpen?: () => void;
}

/** Circular "i" button with a licence-bucket dot. Clicking opens a popover
 *  showing the active style's name, licence pill and attribution HTML. */
export class AttributionButton extends LightElement {
  static properties = {
    open: { state: true },
    currentStyle: { state: true },
  };

  declare open: boolean;
  // Not named `style` — that collides with `HTMLElement.prototype.style`.
  declare currentStyle: AppStyle | null;

  private opts: AttributionButtonOptions = {};

  constructor() {
    super();
    this.open = false;
    this.currentStyle = null;
  }

  /** Inject runtime options. Custom-element constructors take no arguments. */
  init(opts: AttributionButtonOptions = {}): this {
    this.opts = opts;
    return this;
  }

  get el(): this {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("attrib-root");
  }

  /** Update the active style — refreshes the dot colour and the popover. */
  setStyle(style: AppStyle) {
    this.currentStyle = style;
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

  render() {
    return html`
      <button
        class=${classMap({
          "attrib-btn": true,
          "attrib-btn-active": this.open,
        })}
        aria-label="Attribution"
        @click=${() => this.toggle()}
      >
        <!-- Material Symbols "info" (filled). viewBox is Material's 960-grid. -->
        <svg width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
          <path d="M440-280h80v-240h-80v240Zm68.5-331.5Q520-623 520-640t-11.5-28.5Q497-680 480-680t-28.5 11.5Q440-657 440-640t11.5 28.5Q463-600 480-600t28.5-11.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" />
        </svg>
        <span
          class="attrib-dot"
          style=${this.currentStyle
            ? `background:${LICENSE_COLORS[this.currentStyle.license]}`
            : ""}
        ></span>
      </button>
      ${this.open && this.currentStyle
        ? this.renderPopover(this.currentStyle)
        : nothing}
    `;
  }

  private renderPopover(s: AppStyle): TemplateResult {
    const license = s.license;
    const color = LICENSE_COLORS[license];
    return html`
      <div class="attrib-popover-wrap" @click=${() => this.close()}>
        <div
          class="attrib-popover"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="attrib-popover-header">
            <div class="attrib-popover-title-wrap">
              <div class="attrib-popover-title">Attribution</div>
              <span
                class="attrib-pill"
                style="color:${color};background:${hexAlpha(color, 0.12)}"
                >${LICENSE_LABELS[license]}</span
              >
            </div>
            <button
              class="attrib-popover-close"
              aria-label="Close"
              @click=${() => this.close()}
            >×</button>
          </div>
          <div class="attrib-popover-name">${s.name}</div>
          <!-- Attribution is curated HTML from our preset/QMS data (or a plain
               string for custom URLs) — render it so sources can show
               their logos/links. -->
          <div class="attrib-popover-box">
            ${unsafeHTML(s.attribution || "No attribution provided.")}
          </div>
          ${this.renderUsage(s)}
          ${s.termsUrl
            ? html`<a
                class="attrib-terms"
                href=${s.termsUrl}
                target="_blank"
                rel="noopener noreferrer"
                >Terms of use ↗</a
              >`
            : nothing}
          ${license === "attribution" || license === "restrictive"
            ? html`<div class="attrib-popover-footer">
                When downloading, you'll need to acknowledge this source's terms
                before continuing.
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }

  /** Per-aspect usage restrictions — offline download, commercial use and
   *  redistribution — with a colour-coded verdict for each. */
  private renderUsage(s: AppStyle): TemplateResult {
    const r = getRestrictions(s);
    return html`
      <div class="attrib-usage">
        <div class="attrib-usage-title">Usage</div>
        ${USAGE_ASPECTS.map((aspect) => {
          const item = r[aspect];
          const color = VERDICT_COLORS[item.verdict];
          return html`
            <div class="attrib-usage-row">
              <div class="attrib-usage-head">
                <span
                  class="attrib-usage-dot"
                  style="background:${color}"
                ></span>
                <span class="attrib-usage-label"
                  >${USAGE_ASPECT_LABELS[aspect]}</span
                >
                <span class="attrib-usage-verdict" style="color:${color}"
                  >${VERDICT_LABELS[item.verdict]}</span
                >
              </div>
              <div class="attrib-usage-note">${item.note}</div>
            </div>
          `;
        })}
      </div>
    `;
  }
}

if (!customElements.get("attribution-button")) {
  customElements.define("attribution-button", AttributionButton);
}

/** `#rrggbb` + alpha → `rgba(...)`. */
function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
