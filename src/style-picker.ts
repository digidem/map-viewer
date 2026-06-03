import { html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { createRef, ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { LightElement } from "./lit-base.ts";
import {
  PRESET_STYLES,
  PRESET_CATEGORIES,
  CURATED_PRESET_IDS,
  CATEGORY_LABELS,
  LICENSE_COLORS,
  LICENSE_LABELS,
  CUSTOM_URL_ATTRIBUTION,
  fillTileUrl,
  hasSubdomainPlaceholder,
  isTileUrlTemplate,
  lngLatToTile,
  rasterStyleForTileUrl,
  styleForTileJson,
  type AppStyle,
  type CustomStyle,
  type PresetStyle,
  type StyleCategory,
  type StyleKind,
  type TileScheme,
} from "./preset-styles.ts";
import {
  QMS_CATALOGUE,
  qmsToStyle,
  type QmsCatalogueEntry,
} from "./qms-catalogue.ts";
import {
  loadRecents,
  recentIdForUrl,
  removeRecent,
  saveRecent,
  type RecentEntry,
} from "./recents-store.ts";

/** Zoom used for the card preview tile (city-level detail). */
const PREVIEW_ZOOM = 12;

type Tab = "browse" | "recents" | "custom" | "mbtiles";

const TAB_LABELS: Record<Tab, string> = {
  browse: "Browse",
  recents: "Recents",
  custom: "Custom URL",
  mbtiles: ".mbtiles file",
};

/** A row in the Browse grid — a curated preset or a QMS catalogue entry. */
type BrowseEntry =
  | { source: "preset"; preset: PresetStyle }
  | { source: "qms"; qms: QmsCatalogueEntry };

/** Filter chips: `curated` is exclusive (clears the rest); `category` and
 *  `kind` are each single-select but combine as an AND of the two. */
interface FilterState {
  curated: boolean;
  category: StyleCategory | null;
  kind: StyleKind | null;
}

export interface StylePickerOptions {
  /** Selected when user picks a preset, QMS entry or validated custom URL. */
  onSelectStyle: (style: AppStyle) => void;
  /** Triggered when the user picks an .mbtiles file. */
  onSelectMbtiles: (file: File) => void;
  /** True on small viewports — picker becomes full-screen, no drag-drop on mbtiles. */
  isMobile: () => boolean;
}

interface TokenInfo {
  required: boolean;
  providerLabel?: string;
  paramName?: string;
  placeholder?: string;
}

function detectToken(url: string): TokenInfo {
  if (!url) return { required: false };
  const lower = url.toLowerCase();
  const has = (param: string) =>
    new RegExp("[?&]" + param + "=", "i").test(url);
  if (lower.includes("api.mapbox.com")) {
    return has("access_token")
      ? { required: false }
      : {
          required: true,
          providerLabel: "Mapbox",
          paramName: "access_token",
          placeholder: "pk.eyJ1IjoieW91c…",
        };
  }
  if (lower.includes("api.maptiler.com")) {
    return has("key")
      ? { required: false }
      : {
          required: true,
          providerLabel: "MapTiler",
          paramName: "key",
          placeholder: "your MapTiler key",
        };
  }
  if (lower.includes("api.thunderforest.com")) {
    return has("apikey")
      ? { required: false }
      : {
          required: true,
          providerLabel: "Thunderforest",
          paramName: "apikey",
          placeholder: "your Thunderforest API key",
        };
  }
  if (lower.includes("api.stadiamaps.com")) {
    return has("api_key")
      ? { required: false }
      : {
          required: true,
          providerLabel: "Stadia Maps",
          paramName: "api_key",
          placeholder: "your Stadia Maps API key",
        };
  }
  return { required: false };
}

function injectToken(url: string, paramName: string, token: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${paramName}=${encodeURIComponent(token)}`;
}

const DEFAULT_SUBDOMAIN_TEXT = "a, b, c";

/** Split a comma/space-separated subdomain list into trimmed, non-empty parts. */
function parseSubdomains(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Solid card backdrop shown before (or instead of) the tile thumbnail. */
const FALLBACK_BG: Record<string, string> = {
  "street-light": "#e6e5df",
  "street-dark": "#2a2f3a",
  "satellite-light": "#3d5f6e",
  "satellite-dark": "#1a3b5c",
  "terrain-light": "#cdb98c",
  "terrain-dark": "#26331f",
};
function fallbackBg(category: StyleCategory, tone: string): string {
  return FALLBACK_BG[`${category}-${tone}`] ?? "#ccc";
}

const STAR_SVG = html`<svg
  class="sp-star"
  width="11"
  height="11"
  viewBox="0 0 12 12"
  fill="currentColor"
>
  <path d="M6 1l1.5 3.2 3.5.4-2.6 2.4.7 3.4L6 8.7 2.9 10.4l.7-3.4L1 4.6l3.5-.4L6 1z" />
</svg>`;

/** A Browse entry is "curated" when it's a preset in the curated id set. */
function isCuratedEntry(e: BrowseEntry): boolean {
  return e.source === "preset" && CURATED_PRESET_IDS.has(e.preset.id);
}

export class StylePicker extends LightElement {
  static properties = {
    currentStyleId: { state: true },
    tab: { state: true },
    customUrl: { state: true },
    token: { state: true },
    subdomainText: { state: true },
    scheme: { state: true },
    validating: { state: true },
    validateMsg: { state: true },
    isOpen: { state: true },
    previewCenter: { state: true },
    recents: { state: true },
    filter: { state: true },
    dropHot: { state: true },
  };

  // Reactive state.
  declare currentStyleId: string | null;
  declare tab: Tab;
  declare customUrl: string;
  declare token: string;
  /** Comma-separated subdomain list for `{subdomain}`/`{s}` templates. */
  declare subdomainText: string;
  /** Tile scheme chosen in the Custom URL panel for tile-template sources. */
  declare scheme: TileScheme;
  declare validating: boolean;
  declare validateMsg: { ok: boolean; text: string } | null;
  declare isOpen: boolean;
  /** Map center used to pick a preview tile per card. */
  declare previewCenter: [number, number];
  declare recents: RecentEntry[];
  declare filter: FilterState;
  /** Hover state for the desktop .mbtiles drop zone. */
  declare dropHot: boolean;

  // Non-reactive.
  private opts!: StylePickerOptions;
  /** Vendored QMS catalogue — no network request. */
  private qmsEntries = QMS_CATALOGUE;
  private fileInputRef = createRef<HTMLInputElement>();

  constructor() {
    super();
    this.currentStyleId = null;
    this.tab = "browse";
    this.customUrl = "";
    this.token = "";
    this.subdomainText = "";
    this.scheme = "xyz";
    this.validating = false;
    this.validateMsg = null;
    this.isOpen = false;
    this.previewCenter = [0, 51.5];
    this.recents = [];
    this.filter = { curated: true, category: null, kind: null };
    this.dropHot = false;
    // Backdrop click-to-close — desktop only, and only on the host itself.
    this.addEventListener("click", (e) => {
      if (e.target === this && !this.opts?.isMobile()) this.close();
    });
  }

  /** Inject runtime options. Custom-element constructors take no arguments. */
  init(options: StylePickerOptions): this {
    this.opts = options;
    return this;
  }

  /** The component is its own root element. */
  get el(): this {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("sp-backdrop");
    if (!this.isOpen) this.classList.add("hidden");
  }

  open(
    currentStyleId: string | null,
    mapCenter: [number, number] = [0, 51.5],
  ) {
    this.currentStyleId = currentStyleId;
    this.previewCenter = mapCenter;
    this.recents = loadRecents();
    // The filter / selected chips persist across opens — don't reset them.
    // Don't strand the user on the Recents tab if it's no longer available.
    if (this.tab === "recents" && this.recents.length === 0) {
      this.tab = "browse";
    }
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
  }

  protected updated() {
    this.classList.toggle("hidden", !this.isOpen);
    this.classList.toggle("sp-mobile", this.opts.isMobile());
  }

  /** Tab order — Recents only appears when there are recents. */
  private get tabs(): Tab[] {
    return this.recents.length > 0
      ? ["browse", "recents", "custom", "mbtiles"]
      : ["browse", "custom", "mbtiles"];
  }

  private setTab(t: Tab) {
    this.tab = t;
    this.validateMsg = null;
  }

  render() {
    if (!this.isOpen) return nothing;
    return html`
      <div class="sp-inner">
        <div class="sp-header">
          <div class="sp-title">Map style</div>
          <button class="sp-close" aria-label="Close" @click=${() => this.close()}>×</button>
        </div>
        <div class="sp-tabs">
          ${this.tabs.map(
            (t) => html`
              <button
                class=${classMap({
                  "sp-tab": true,
                  "sp-tab-active": t === this.tab,
                })}
                data-tab=${t}
                @click=${() => this.setTab(t)}
              >
                ${TAB_LABELS[t]}
              </button>
            `,
          )}
        </div>
        <div class="sp-body">${this.renderBody()}</div>
      </div>
    `;
  }

  private renderBody(): TemplateResult {
    if (this.tab === "browse") return this.renderBrowse();
    if (this.tab === "recents") return this.renderRecents();
    if (this.tab === "custom") return this.renderCustom();
    return this.renderMbtiles();
  }

  // ─── Browse tab ─────────────────────────────────────────────────────────

  /** All Browse rows — curated presets plus the vendored QMS catalogue. */
  private allEntries(): BrowseEntry[] {
    const out: BrowseEntry[] = PRESET_STYLES.map((preset) => ({
      source: "preset" as const,
      preset,
    }));
    for (const qms of this.qmsEntries) {
      out.push({ source: "qms", qms });
    }
    return out;
  }

  private entryCategory(e: BrowseEntry): StyleCategory {
    return e.source === "preset" ? e.preset.category : e.qms.category;
  }
  private entryKind(e: BrowseEntry): StyleKind {
    return e.source === "preset" ? e.preset.kind : "raster";
  }

  /** Does an entry pass the active filter? Curated is exclusive — when it's on
   *  only the curated set shows. Otherwise category and kind combine as an AND. */
  private passes(e: BrowseEntry) {
    const f = this.filter;
    if (f.curated) return isCuratedEntry(e);
    if (f.category && f.category !== this.entryCategory(e)) return false;
    if (f.kind && f.kind !== this.entryKind(e)) return false;
    return true;
  }

  private filteredEntries(): BrowseEntry[] {
    const list = this.allEntries().filter((e) => this.passes(e));
    // Presets (curated) first, then QMS by popularity descending.
    list.sort((a, b) => {
      const ap = a.source === "preset" ? 0 : 1;
      const bp = b.source === "preset" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (a.source === "qms" && b.source === "qms") {
        return b.qms.popularity - a.qms.popularity;
      }
      return 0;
    });
    return list;
  }

  private entryId(e: BrowseEntry): string {
    return e.source === "preset" ? e.preset.id : `qms-${e.qms.qmsId}`;
  }

  private renderBrowse(): TemplateResult {
    const results = this.filteredEntries();
    return html`
      <div class="sp-browse">
        ${this.buildChipRow()}
        ${results.length === 0
          ? html`
              <div class="sp-empty">
                <div class="sp-empty-mark">∅</div>
                <div>Nothing matches those filters.</div>
                <div class="sp-empty-sub">Tap All to show everything.</div>
              </div>
            `
          : html`
              <div
                class=${classMap({
                  "sp-preset-grid": true,
                  "sp-preset-grid-mobile": this.opts.isMobile(),
                })}
              >
                ${repeat(
                  results,
                  (e) => this.entryId(e),
                  (e) => this.browseCard(e),
                )}
              </div>
            `}
      </div>
    `;
  }

  private buildChipRow(): TemplateResult {
    interface ChipDef {
      label: string;
      active: boolean;
      count: number;
      star?: boolean;
      toggle: () => void;
    }
    const all = this.allEntries();
    const f = this.filter;
    const chips: ChipDef[] = [];
    chips.push({
      label: "All",
      // Auto-active whenever no other chip is selected.
      active: !f.curated && f.category === null && f.kind === null,
      count: all.length,
      toggle: () => {
        this.filter = { curated: false, category: null, kind: null };
      },
    });
    chips.push({
      label: "Curated",
      star: true,
      active: f.curated,
      count: all.filter(isCuratedEntry).length,
      toggle: () => {
        // Curated is exclusive — turning it on clears the other chips;
        // turning it off leaves the gallery unfiltered.
        this.filter = f.curated
          ? { ...f, curated: false }
          : { curated: true, category: null, kind: null };
      },
    });
    for (const cat of PRESET_CATEGORIES) {
      chips.push({
        label: cat.label,
        active: f.category === cat.id,
        // AND'd with the selected kind — the count is what picking this chip
        // would actually show.
        count: all.filter(
          (e) =>
            this.entryCategory(e) === cat.id &&
            (f.kind === null || this.entryKind(e) === f.kind),
        ).length,
        toggle: () => {
          // Category is single-select; selecting one turns Curated off but
          // keeps any selected kind.
          this.filter = {
            curated: false,
            category: f.category === cat.id ? null : cat.id,
            kind: f.kind,
          };
        },
      });
    }
    for (const kind of ["vector", "raster"] as StyleKind[]) {
      chips.push({
        label: kind === "vector" ? "Vector" : "Raster",
        active: f.kind === kind,
        count: all.filter(
          (e) =>
            this.entryKind(e) === kind &&
            (f.category === null || this.entryCategory(e) === f.category),
        ).length,
        toggle: () => {
          this.filter = {
            curated: false,
            category: f.category,
            kind: f.kind === kind ? null : kind,
          };
        },
      });
    }

    return html`
      <div class="sp-chip-row">
        ${chips.map((c) => {
          const dim = c.count === 0 && !c.active;
          return html`
            <button
              type="button"
              class=${classMap({
                "sp-chip": true,
                "sp-chip-active": c.active,
                "sp-chip-dim": dim,
              })}
              ?disabled=${dim}
              @click=${c.toggle}
            >
              ${c.star ? STAR_SVG : nothing}
              <span class="sp-chip-label">${c.label}</span>
              <span class="sp-chip-count">${c.count}</span>
            </button>
          `;
        })}
      </div>
    `;
  }

  private browseCard(e: BrowseEntry): TemplateResult {
    const isPreset = e.source === "preset";
    const id = this.entryId(e);
    const name = isPreset ? e.preset.name : e.qms.name;
    const desc = isPreset ? e.preset.desc : e.qms.desc;
    const category = this.entryCategory(e);
    const tone = isPreset ? e.preset.tone : e.qms.tone;
    const kind = this.entryKind(e);
    const license = isPreset ? e.preset.license : e.qms.license;
    const tileUrl = isPreset ? e.preset.previewTileUrl : e.qms.url;
    const scheme = isPreset ? e.preset.scheme : undefined;
    const previewSubdomains = isPreset ? e.preset.subdomains : e.qms.subdomains;
    const pz = (isPreset && e.preset.previewZoom) || PREVIEW_ZOOM;
    const [lng, lat] = this.previewCenter;
    const { x, y } = lngLatToTile(lng, lat, pz);
    // TMS sources count y from the bottom — flip it for the preview tile.
    const ty = scheme === "tms" ? 2 ** pz - 1 - y : y;

    return html`
      <button
        class=${classMap({
          "sp-preset-card": true,
          "sp-preset-active": this.currentStyleId === id,
        })}
        type="button"
        @click=${() => {
          this.opts.onSelectStyle(isPreset ? e.preset : qmsToStyle(e.qms));
          this.close();
        }}
      >
        <div class="sp-thumb" style="background:${fallbackBg(category, tone)}">
          <img
            class="sp-thumb-img"
            alt=""
            referrerpolicy="no-referrer"
            loading="lazy"
            decoding="async"
            src=${fillTileUrl(tileUrl, pz, x, ty, previewSubdomains)}
            @error=${(ev: Event) =>
              ((ev.target as HTMLElement).style.display = "none")}
          />
          ${isPreset
            ? html`<div class="sp-badge-star" title="Curated pick">
                ${STAR_SVG}
              </div>`
            : nothing}
        </div>
        <div class="sp-preset-meta">
          <div class="sp-preset-name-row">
            <div class="sp-preset-name">${name}</div>
            <span
              class="sp-license-dot"
              style="background:${LICENSE_COLORS[license]}"
              title=${LICENSE_LABELS[license]}
            ></span>
          </div>
          <div class="sp-preset-desc">${desc}</div>
          <div class="sp-preset-tag">
            ${kind} · ${CATEGORY_LABELS[category]}
          </div>
        </div>
      </button>
    `;
  }

  // ─── Recents tab ────────────────────────────────────────────────────────

  private renderRecents(): TemplateResult {
    return html`
      <div
        class=${classMap({
          "sp-preset-grid": true,
          "sp-preset-grid-mobile": this.opts.isMobile(),
        })}
      >
        ${repeat(
          this.recents,
          (r) => r.id,
          (r) => this.recentCard(r),
        )}
      </div>
    `;
  }

  private removeRecentEntry(r: RecentEntry) {
    removeRecent(r.id);
    this.recents = loadRecents();
    if (this.recents.length === 0) this.tab = "browse";
  }

  private recentCard(r: RecentEntry): TemplateResult {
    let host = r.url;
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      /* leave as-is */
    }
    let imgUrl: string | null = null;
    if (r.previewKind === "raster" && r.previewTileUrl) {
      const [lng, lat] = this.previewCenter;
      const { x, y } = lngLatToTile(lng, lat, PREVIEW_ZOOM);
      imgUrl = fillTileUrl(r.previewTileUrl, PREVIEW_ZOOM, x, y, r.subdomains);
    }
    return html`
      <button
        class=${classMap({
          "sp-preset-card": true,
          "sp-preset-active": this.currentStyleId === "custom",
        })}
        type="button"
        @click=${(ev: Event) => {
          if (
            (ev.target as HTMLElement).classList.contains("sp-recent-remove")
          ) {
            return;
          }
          this.opts.onSelectStyle(this.styleFromRecent(r));
          this.close();
        }}
      >
        <div class="sp-thumb" style="background:#dcdad4">
          ${imgUrl
            ? html`<img
                class="sp-thumb-img"
                alt=""
                referrerpolicy="no-referrer"
                crossorigin="anonymous"
                loading="lazy"
                decoding="async"
                src=${imgUrl}
                @error=${(ev: Event) =>
                  ((ev.target as HTMLElement).style.display = "none")}
              />`
            : nothing}
        </div>
        <div class="sp-preset-meta">
          <div class="sp-preset-name">${host}</div>
          <div class="sp-preset-desc">${r.url}</div>
          <div class="sp-recent-row">
            <span class="sp-preset-tag">${r.kind} · custom</span>
            <button
              class="sp-recent-remove"
              type="button"
              aria-label="Remove from recents"
              @click=${(ev: Event) => {
                ev.stopPropagation();
                this.removeRecentEntry(r);
              }}
            >
              ×
            </button>
          </div>
        </div>
      </button>
    `;
  }

  private styleFromRecent(r: RecentEntry): CustomStyle {
    return {
      id: "custom",
      name: r.name,
      desc: r.url,
      url: r.url,
      kind: r.kind,
      spec: r.spec,
      accessToken: r.accessToken,
      maxZoom: r.maxZoom,
      // Custom sources carry no licence metadata — flag them restrictive.
      license: "restrictive",
      attribution: CUSTOM_URL_ATTRIBUTION,
    };
  }

  // ─── Custom URL tab ─────────────────────────────────────────────────────

  private validateBtnDisabled(): boolean {
    const tokenInfo = detectToken(this.customUrl);
    return (
      !this.customUrl ||
      this.validating ||
      (tokenInfo.required && !this.token)
    );
  }

  private renderCustom(): TemplateResult {
    const tokenInfo = detectToken(this.customUrl);
    const disabled = this.validateBtnDisabled();
    return html`
      <div class="sp-custom">
        <p class="sp-prose">
          Paste a link to a Mapbox/MapLibre <code>style.json</code>, a TileJSON,
          or a tile URL template containing <code>{z}/{x}/{y}</code> or
          <code>{quadkey}</code>.
        </p>
        <input
          type="url"
          class="sp-input sp-url"
          placeholder="https://example.com/style.json"
          .value=${this.customUrl}
          @input=${(e: Event) =>
            (this.customUrl = (e.target as HTMLInputElement).value)}
        />
        ${isTileUrlTemplate(this.customUrl)
          ? this.renderSchemeSection()
          : nothing}
        ${tokenInfo.required ? this.renderTokenSection(tokenInfo) : nothing}
        ${hasSubdomainPlaceholder(this.customUrl)
          ? this.renderSubdomainSection()
          : nothing}
        <div class="sp-validate-msg">
          ${this.validateMsg
            ? html`<div
                class="sp-msg ${this.validateMsg.ok
                  ? "sp-msg-ok"
                  : "sp-msg-err"}"
              >
                ${this.validateMsg.text}
              </div>`
            : nothing}
        </div>
        <button
          class=${classMap({
            "sp-validate-btn": true,
            "sp-btn-disabled": disabled,
          })}
          type="button"
          ?disabled=${disabled}
          @click=${() => this.validateAndSelect()}
        >
          ${this.validating ? "Validating…" : "Validate & use"}
        </button>
      </div>
    `;
  }

  /** XYZ/TMS picker — only shown for tile-template URLs. */
  private renderSchemeSection(): TemplateResult {
    return html`
      <div class="sp-scheme-wrap">
        <div class="sp-scheme-box">
          <div class="sp-scheme-title">Tile scheme</div>
          <div class="sp-scheme-options">
            ${(["xyz", "tms"] as TileScheme[]).map(
              (s) => html`
                <button
                  type="button"
                  class=${classMap({
                    "sp-scheme-opt": true,
                    "sp-scheme-opt-active": this.scheme === s,
                  })}
                  data-scheme=${s}
                  @click=${() => (this.scheme = s)}
                >
                  <span class="sp-scheme-opt-name">${s.toUpperCase()}</span>
                  <span class="sp-scheme-opt-hint">
                    ${s === "xyz"
                      ? "Y axis grows downward (Google / OSM)."
                      : "Y axis grows upward (OGC TMS spec)."}
                  </span>
                </button>
              `,
            )}
          </div>
          <div class="sp-scheme-hint">
            Tiles appear upside-down or mis-stacked? Toggle this.
          </div>
        </div>
      </div>
    `;
  }

  private renderTokenSection(info: TokenInfo): TemplateResult {
    return html`
      <div class="sp-token-wrap">
        <div class="sp-token-box">
          <div class="sp-token-header">
            <span class="sp-token-provider">
              ${info.providerLabel} access token required
            </span>
            <span class="sp-token-param">?${info.paramName}=</span>
          </div>
          <input
            type="text"
            class="sp-input sp-token-input"
            placeholder=${info.placeholder ?? ""}
            autocomplete="off"
            spellcheck="false"
            .value=${this.token}
            @input=${(e: Event) =>
              (this.token = (e.target as HTMLInputElement).value)}
          />
          <div class="sp-token-hint">
            Appended to the URL at request time. Your token isn't stored or
            shared.
          </div>
        </div>
      </div>
    `;
  }

  private renderSubdomainSection(): TemplateResult {
    return html`
      <div class="sp-subdomain-wrap">
        <div class="sp-token-box">
          <div class="sp-token-header">
            <span class="sp-token-provider">Subdomains</span>
            <span class="sp-token-param">{subdomain}</span>
          </div>
          <input
            type="text"
            class="sp-input sp-token-input sp-subdomain-input"
            placeholder=${DEFAULT_SUBDOMAIN_TEXT}
            autocomplete="off"
            spellcheck="false"
            .value=${this.subdomainText}
            @input=${(e: Event) =>
              (this.subdomainText = (e.target as HTMLInputElement).value)}
          />
          <div class="sp-token-hint">
            Comma-separated hosts to round-robin across (e.g.
            <code>t0, t1, t2, t3</code> for Bing). Defaults to
            <code>${DEFAULT_SUBDOMAIN_TEXT}</code>.
          </div>
        </div>
      </div>
    `;
  }

  private async validateAndSelect() {
    if (!this.customUrl) return;
    const tokenInfo = detectToken(this.customUrl);
    if (tokenInfo.required && !this.token) {
      this.validateMsg = {
        ok: false,
        text: `${tokenInfo.providerLabel} requires an access token`,
      };
      return;
    }
    this.validating = true;
    this.validateMsg = null;

    try {
      const finalUrl =
        tokenInfo.required && this.token
          ? injectToken(this.customUrl, tokenInfo.paramName!, this.token)
          : this.customUrl;

      const subdomains = hasSubdomainPlaceholder(this.customUrl)
        ? parseSubdomains(this.subdomainText)
        : undefined;
      const scheme = isTileUrlTemplate(this.customUrl)
        ? this.scheme
        : undefined;

      const resolved = await resolveCustomStyle(finalUrl, subdomains, scheme);
      const accessToken = tokenInfo.required ? this.token : undefined;

      this.validateMsg = { ok: true, text: "Validated. Loading…" };
      const styleWithToken: CustomStyle = {
        ...resolved.style,
        accessToken,
      };
      saveRecent({
        id: recentIdForUrl(this.customUrl),
        url: this.customUrl,
        name: this.customUrl,
        kind: resolved.style.kind,
        spec: resolved.style.spec,
        accessToken,
        maxZoom: resolved.style.maxZoom,
        previewTileUrl: resolved.previewTileUrl,
        previewKind: resolved.previewTileUrl ? "raster" : undefined,
        subdomains: subdomains?.length ? subdomains : undefined,
        addedAt: Date.now(),
      });
      this.opts.onSelectStyle(styleWithToken);
      setTimeout(() => this.close(), 400);
    } catch (e) {
      this.validateMsg = {
        ok: false,
        text: (e as Error).message ?? "Validation failed",
      };
    } finally {
      this.validating = false;
    }
  }

  // ─── mbtiles tab ────────────────────────────────────────────────────────

  private openFilePicker = () => {
    this.fileInputRef.value?.click();
  };

  private onFileInputChange = () => {
    const f = this.fileInputRef.value?.files?.[0];
    if (f) {
      this.opts.onSelectMbtiles(f);
      this.close();
    }
  };

  private onMbtilesDrop = (e: DragEvent) => {
    e.preventDefault();
    this.dropHot = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) {
      this.opts.onSelectMbtiles(f);
      this.close();
    }
  };

  private renderMbtiles(): TemplateResult {
    const isMobile = this.opts.isMobile();
    return html`
      <div class="sp-mbtiles">
        <p class="sp-prose">
          Load a local <code>.mbtiles</code> file as the basemap. The map view
          will fit to the file's bounds.
        </p>
        ${isMobile
          ? html`<button
              class="sp-mbtiles-btn"
              type="button"
              @click=${this.openFilePicker}
            >
              Choose .mbtiles file
            </button>`
          : html`<div
              class=${classMap({
                "sp-mbtiles-drop": true,
                "sp-mbtiles-drop-hot": this.dropHot,
              })}
              @click=${this.openFilePicker}
              @dragover=${(e: DragEvent) => {
                e.preventDefault();
                this.dropHot = true;
              }}
              @dragleave=${() => (this.dropHot = false)}
              @drop=${this.onMbtilesDrop}
            >
              <div class="sp-mbtiles-drop-title">Drop a .mbtiles file</div>
              <div class="sp-mbtiles-drop-sub">or click to choose</div>
            </div>`}
        <input
          type="file"
          accept=".mbtiles,.sqlite,.sqlite3,.db"
          class="sp-mbtiles-input"
          hidden
          ${ref(this.fileInputRef)}
          @change=${this.onFileInputChange}
        />
      </div>
    `;
  }
}

if (!customElements.get("style-picker")) {
  customElements.define("style-picker", StylePicker);
}

interface ResolvedCustom {
  style: CustomStyle;
  /** Raster {z}/{x}/{y} URL we can use as a thumbnail. Unset when the source
   *  is vector pbf or we couldn't derive one. */
  previewTileUrl?: string;
}

/** Probe a custom URL and return an AppStyle plus a thumbnail tile URL when
 *  derivable. Handles three cases: tile URL template, TileJSON, full style. */
async function resolveCustomStyle(
  url: string,
  subdomains?: string[],
  scheme?: TileScheme,
): Promise<ResolvedCustom> {
  if (isTileUrlTemplate(url)) {
    // Probe at z=1 so `{quadkey}` resolves to a real tile ("0") — Bing-style
    // sources have no z=0 tile, where the quadkey would be empty.
    const probe = fillTileUrl(url, 1, 0, 0, subdomains);
    const r = await fetch(probe, { method: "GET" });
    if (!r.ok) throw new Error(`Tile probe failed: ${r.status}`);
    return {
      style: {
        id: "custom",
        name: "Custom tile URL",
        desc: url,
        url,
        kind: "raster",
        scheme,
        spec: rasterStyleForTileUrl(url, subdomains, scheme),
        license: "restrictive",
        attribution: CUSTOM_URL_ATTRIBUTION,
      },
      previewTileUrl: url,
    };
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  const json = (await r.json()) as Record<string, unknown>;
  // Maplibre style: has version 8 and sources
  if (json.version === 8 && typeof json.sources === "object") {
    return {
      style: {
        id: "custom",
        name: "Custom style",
        desc: url,
        url,
        kind: "vector",
        license: "restrictive",
        attribution: CUSTOM_URL_ATTRIBUTION,
      },
    };
  }
  // TileJSON: has tiles array (or tilejson key)
  if (Array.isArray(json.tiles) || typeof json.tilejson === "string") {
    const fmt = String(json.format ?? "").toLowerCase();
    const kind: "vector" | "raster" = fmt === "pbf" ? "vector" : "raster";
    const tiles = Array.isArray(json.tiles) ? (json.tiles as string[]) : [];
    const maxZoom =
      typeof json.maxzoom === "number" ? (json.maxzoom as number) : undefined;
    return {
      style: {
        id: "custom",
        name: "Custom TileJSON",
        desc: url,
        url,
        kind,
        maxZoom,
        spec: styleForTileJson(url, kind),
        license: "restrictive",
        attribution: CUSTOM_URL_ATTRIBUTION,
      },
      previewTileUrl: kind === "raster" ? tiles[0] : undefined,
    };
  }
  throw new Error("Not a valid style or TileJSON");
}
