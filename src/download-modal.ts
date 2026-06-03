import { html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { LightElement } from "./lit-base.ts";
import { BboxMap, type GeoBbox } from "./bbox-map.ts";
import {
  bboxToArr,
  countTiles,
  DEFAULT_AVG_TILE_BYTES,
  DEFAULT_MAX_ZOOM,
  HUGE_MB,
  HUGE_TILES,
  MAX_ZOOM_LIMIT,
  MIN_ZOOM_LIMIT,
  WARN_MB,
  WARN_TILES,
} from "./estimate.ts";
import {
  getRestrictions,
  USAGE_ASPECT_LABELS,
  VERDICT_COLORS,
  VERDICT_ICON_PATHS,
  VERDICT_LABELS,
  type AppStyle,
  type UsageVerdict,
} from "./preset-styles.ts";
import {
  getStyleMaxZoomAsync,
  getStyleMaxZoomSync,
  resolveDataTileUrls,
  sampleAvgTileBytes,
} from "./tile-sampler.ts";

type Status = "idle" | "downloading" | "error" | "success";

export interface DownloadRequest {
  style: AppStyle;
  bbox: GeoBbox;
  maxZoom: number;
  name: string;
  description: string;
}

export interface DownloadController {
  cancel(): void;
}

export interface DownloadModalOptions {
  /** Triggered when the user clicks Download. The handler is responsible for
   *  driving the streaming download and reporting progress via the returned
   *  controller. The modal stays open and shows progress until either
   *  `onProgress` is called with `done: true` or `onError` is called. */
  onDownload: (
    req: DownloadRequest,
    callbacks: {
      onProgress: (p: { fraction: number; done?: boolean }) => void;
      onError: (msg: string) => void;
    },
  ) => DownloadController;
  isMobile: () => boolean;
}

export class DownloadModal extends LightElement {
  static properties = {
    isOpen: { state: true },
    mobile: { state: true },
    step: { state: true },
    status: { state: true },
    progress: { state: true },
    errorText: { state: true },
    maxZoom: { state: true },
    name: { state: true },
    desc: { state: true },
    acknowledged: { state: true },
    effectiveMaxZoom: { state: true },
    avgTileBytes: { state: true },
    currentStyle: { state: true },
    currentGeoBbox: { state: true },
  };

  // Reactive state — declared (not class fields, which would shadow the
  // accessors Lit installs) and initialised in the constructor.
  declare isOpen: boolean;
  declare mobile: boolean;
  declare step: 1 | 2;
  declare status: Status;
  declare progress: number;
  declare errorText: string | null;
  declare maxZoom: number;
  declare name: string;
  declare desc: string;
  /** Ticked the licence-acknowledgement checkbox (attribution/restrictive styles). */
  declare acknowledged: boolean;
  /** Effective slider cap. Starts at the global MAX_ZOOM_LIMIT, narrowed down
   *  once the source's actual maxzoom is known (preset.maxZoom, mbtiles
   *  metadata, or a fetched style.json/TileJSON). */
  declare effectiveMaxZoom: number;
  declare avgTileBytes: number | null;
  declare currentStyle: AppStyle | null;
  declare currentGeoBbox: GeoBbox | null;

  // Non-reactive plain fields — mutating these must not schedule a render.
  private opts!: DownloadModalOptions;
  /** The huge-download confirmation overlay while it's open. */
  private hugeConfirmEl: HTMLDivElement | null = null;
  private previewMap: BboxMap | null = null;
  /** Stable host node for the BboxMap preview — interpolated into the template
   *  so Lit reuses it across re-renders and the MapLibre canvas survives. */
  private previewContainer: HTMLDivElement | null = null;
  private controller: DownloadController | null = null;
  // Size sampler state. Cache is per (style, maxZoom) and seeded fresh on each
  // open(). The abort controller cancels in-flight fetches when the user changes
  // the slider before a previous run completes.
  private resolvedTileUrls: string[] | null = null;
  private resolvedTileUrlsForStyleId: string | null = null;
  private sampleByZoom = new Map<number, number>();
  private sampleAbort: AbortController | null = null;
  private sampleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxZoomResolveAbort: AbortController | null = null;

  constructor() {
    super();
    this.isOpen = false;
    this.mobile = false;
    this.step = 1;
    this.status = "idle";
    this.progress = 0;
    this.errorText = null;
    this.maxZoom = DEFAULT_MAX_ZOOM;
    this.name = "";
    this.desc = "";
    this.acknowledged = false;
    this.effectiveMaxZoom = MAX_ZOOM_LIMIT;
    this.avgTileBytes = null;
    this.currentStyle = null;
    this.currentGeoBbox = null;
    // Backdrop click-to-close — only a click landing on the host itself counts.
    this.addEventListener("click", (e) => {
      if (e.target === this && this.status !== "downloading") this.close();
    });
  }

  /** Inject runtime options. Custom-element constructors take no arguments. */
  init(options: DownloadModalOptions): this {
    this.opts = options;
    return this;
  }

  /** The component is its own root element. */
  get el(): this {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("dm-backdrop");
    if (!this.isOpen) this.classList.add("hidden");
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.sampleAbort?.abort();
    this.maxZoomResolveAbort?.abort();
    if (this.sampleTimer) clearTimeout(this.sampleTimer);
    this.sampleTimer = null;
    this.previewMap?.destroy();
    this.previewMap = null;
  }

  open(args: {
    style: AppStyle;
    geoBbox: GeoBbox | null;
    currentMapZoom: number;
  }) {
    this.currentStyle = args.style;
    this.currentGeoBbox = args.geoBbox;

    // Optimistic cap from sync data (mbtiles metadata, recents that persisted
    // a resolved max, or a raster wrapper spec with inline source.maxzoom).
    // The async resolver below tightens this once it walks the actual
    // style/TileJSON or probes a tile URL.
    const syncMax = getStyleMaxZoomSync(args.style);
    this.effectiveMaxZoom = Math.min(MAX_ZOOM_LIMIT, syncMax ?? MAX_ZOOM_LIMIT);
    this.maxZoom = Math.min(
      this.effectiveMaxZoom,
      Math.max(Math.round(args.currentMapZoom + 2), DEFAULT_MAX_ZOOM),
    );

    this.name = "";
    this.desc = "";
    this.acknowledged = false;
    this.closeHugeConfirm();
    this.status = "idle";
    this.progress = 0;
    this.errorText = null;
    this.step = 1;
    this.mobile = this.opts.isMobile();

    // Reset sampler state for the new style. Cache is keyed by maxZoom only —
    // the bbox is locked for the duration of the modal session.
    if (this.resolvedTileUrlsForStyleId !== args.style.id) {
      this.resolvedTileUrls = null;
      this.resolvedTileUrlsForStyleId = args.style.id;
    }
    this.avgTileBytes = null;
    this.sampleByZoom.clear();
    this.sampleAbort?.abort();
    this.sampleAbort = null;
    this.maxZoomResolveAbort?.abort();
    this.maxZoomResolveAbort = null;

    // Fresh preview container for this session — the BboxMap is built lazily
    // in updated() once it's connected and sized.
    this.previewMap?.destroy();
    this.previewMap = null;
    this.previewContainer = document.createElement("div");
    this.previewContainer.className = "dm-preview-host";

    this.isOpen = true;
    this.kickoffSample(0);

    // Always run the async resolver. It walks style.json → TileJSON, then
    // (for tile URL templates without metadata) probes the actual tile server
    // to find the highest zoom that returns content.
    void this.resolveAsyncMaxZoom();
  }

  close() {
    if (this.status === "downloading") return;
    this.closeHugeConfirm();
    this.controller?.cancel();
    this.controller = null;
    this.previewMap?.destroy();
    this.previewMap = null;
    this.previewContainer = null;
    this.isOpen = false;
    this.sampleAbort?.abort();
    this.sampleAbort = null;
    this.maxZoomResolveAbort?.abort();
    this.maxZoomResolveAbort = null;
    if (this.sampleTimer) clearTimeout(this.sampleTimer);
    this.sampleTimer = null;
  }

  render() {
    if (!this.isOpen) return nothing;
    return this.mobile ? this.renderMobile() : this.renderDesktop();
  }

  protected updated() {
    this.classList.toggle("hidden", !this.isOpen);
    this.classList.toggle("dm-mobile", this.mobile);
    // Build the preview map once the stable container is connected and sized.
    if (this.isOpen && this.previewContainer && !this.previewMap) {
      this.buildPreviewMap(this.previewContainer);
    }
    if (this.previewMap && this.previewContainer?.isConnected) {
      this.previewMap.map.resize();
      if (Math.round(this.previewMap.map.getZoom()) !== this.maxZoom) {
        this.previewMap.map.easeTo({ zoom: this.maxZoom, duration: 250 });
      }
    }
  }

  private get tileCount() {
    if (!this.currentGeoBbox) return 0;
    return countTiles(bboxToArr(this.currentGeoBbox), this.maxZoom);
  }

  private get bytesPerTile() {
    return this.avgTileBytes ?? DEFAULT_AVG_TILE_BYTES;
  }

  private get sizeMB() {
    return (this.tileCount * this.bytesPerTile) / (1024 * 1024);
  }

  /** True once the size estimate is using a real sample (not the fallback
   *  constant) — used to dim the value slightly while it's provisional. */
  private get sizeIsFromSample() {
    return this.avgTileBytes != null;
  }

  private get warnLevel(): "soft" | "huge" | null {
    if (this.tileCount >= HUGE_TILES || this.sizeMB >= HUGE_MB) return "huge";
    if (this.tileCount >= WARN_TILES || this.sizeMB >= WARN_MB) return "soft";
    return null;
  }

  /** Restrictive/attribution styles require ticking the licence checkbox. */
  private get needsAck(): boolean {
    const lic = this.currentStyle?.license;
    return lic === "attribution" || lic === "restrictive";
  }

  /** Whether the primary action is allowed to start from the idle state. */
  private get canStart(): boolean {
    return !this.needsAck || this.acknowledged;
  }

  private buildPreviewMap(host: HTMLDivElement) {
    if (this.previewMap || !this.currentStyle || !this.currentGeoBbox) return;
    this.previewMap = new BboxMap({
      container: host,
      initialStyle: this.currentStyle,
      initialCenter: [
        (this.currentGeoBbox.west + this.currentGeoBbox.east) / 2,
        (this.currentGeoBbox.south + this.currentGeoBbox.north) / 2,
      ],
      initialZoom: this.maxZoom,
      lockedGeoBbox: this.currentGeoBbox,
      lockZoom: true,
      enableResize: false,
      bboxColor: "yellow",
    });
  }

  private renderDesktop(): TemplateResult {
    return html`
      <div class="dm-inner">
        <div class="dm-header">
          <div>
            <div class="dm-title">Download map package</div>
            <div class="dm-subtitle">Set max zoom and metadata</div>
          </div>
          <button class="dm-close" aria-label="Close" @click=${() => this.close()}>×</button>
        </div>
        <div class="dm-body">
          <div class="dm-preview-col">
            ${this.previewContainer}
            ${this.previewBadges()}
          </div>
          <div class="dm-form-col">
            ${this.buildZoomSlider()}
            ${this.buildNameDescFields()}
            ${this.buildBoundsRow()}
            ${this.buildEstimate()}
            ${this.buildLicenceBanner()}
            ${this.buildWarning()}
            ${this.status === "error" && this.errorText
              ? this.buildErrorBanner()
              : nothing}
            ${this.status === "downloading" ? this.buildProgress() : nothing}
            ${this.status === "success" ? this.buildSuccess() : nothing}
            ${this.buildPrimaryButton()}
          </div>
        </div>
      </div>
    `;
  }

  private renderMobile(): TemplateResult {
    return html`
      <div class="dm-mobile-inner">
        <div class="dm-mobile-header">
          <div class="dm-mobile-header-left">
            ${this.step === 2
              ? html`
                  <button
                    class="dm-mobile-back"
                    aria-label="Back"
                    ?disabled=${this.status === "downloading"}
                    @click=${() => (this.step = 1)}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <path d="M11 4l-5 5 5 5" />
                    </svg>
                  </button>
                `
              : nothing}
            <div>
              <div class="dm-mobile-title">
                ${this.step === 1 ? "Set zoom level" : "Name & download"}
              </div>
              <div class="dm-mobile-step">Step ${this.step} of 2</div>
            </div>
          </div>
          <button
            class="dm-mobile-close"
            aria-label="Close"
            ?disabled=${this.status === "downloading"}
            @click=${() => this.close()}
          >×</button>
        </div>
        <div class="dm-mobile-progress">
          <div
            class="dm-mobile-progress-fill"
            style="width: ${this.step === 1 ? "50%" : "100%"}"
          ></div>
        </div>
        ${this.step === 1 ? this.renderMobileStep1() : this.renderMobileStep2()}
      </div>
    `;
  }

  private renderMobileStep1(): TemplateResult {
    return html`
      ${this.previewContainer}
      ${this.previewBadges()}
      <div class="dm-mobile-form">
        ${this.buildZoomSlider()}
        ${this.buildEstimate()}
        ${this.buildWarning()}
        <button class="dm-primary" @click=${() => (this.step = 2)}>
          Continue
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M3 7h8M7 3l4 4-4 4" />
          </svg>
        </button>
      </div>
    `;
  }

  private renderMobileStep2(): TemplateResult {
    return html`
      <div class="dm-mobile-form">
        ${this.buildNameDescFields()}
        ${this.buildBoundsRow()}
        ${this.buildEstimate()}
        ${this.buildLicenceBanner()}
        ${this.buildWarning()}
        ${this.status === "error" && this.errorText
          ? this.buildErrorBanner()
          : nothing}
        ${this.status === "downloading" ? this.buildProgress() : nothing}
        ${this.status === "success" ? this.buildSuccess() : nothing}
        <div class="dm-mobile-primary-wrap">${this.buildPrimaryButton()}</div>
      </div>
    `;
  }

  private previewBadges(): TemplateResult {
    return html`
      <div class="dm-preview-badges">
        <div class="dm-preview-zoom">Preview · zoom ${this.maxZoom}</div>
        <div class="dm-preview-hint">
          Pan to inspect features at this zoom · zoom is locked
        </div>
      </div>
    `;
  }

  private onZoomInput = (e: Event) => {
    this.maxZoom = Number((e.target as HTMLInputElement).value);
    this.applyCachedSampleForZoom();
    // Debounced live sample for the new zoom; the cached value (if any) shows
    // immediately so the user isn't staring at "—".
    this.kickoffSample(250);
  };

  private buildZoomSlider(): TemplateResult {
    return html`
      <div>
        <label class="dm-label">Max zoom</label>
        <div class="dm-zoom-row">
          <input
            type="range"
            min=${MIN_ZOOM_LIMIT}
            max=${this.effectiveMaxZoom}
            step="1"
            class="dm-zoom-slider"
            .value=${String(this.maxZoom)}
            @input=${this.onZoomInput}
          />
          <span class="dm-zoom-num">${this.maxZoom}</span>
        </div>
        <div class="dm-zoom-ticks">
          <span>City</span><span>Street</span><span>Building</span>
        </div>
      </div>
    `;
  }

  /** Pull the cached avg-bytes for the current maxZoom (if any) into
   *  `this.avgTileBytes` so the estimate repaints with it. */
  private applyCachedSampleForZoom() {
    this.avgTileBytes = this.sampleByZoom.get(this.maxZoom) ?? null;
  }

  /** Kick off a tile-size sample for the current (style, maxZoom) after the
   *  given debounce. If a result is already cached we only update the UI. */
  private kickoffSample(debounceMs: number) {
    if (!this.currentStyle || !this.currentGeoBbox) return;
    if (this.sampleByZoom.has(this.maxZoom)) {
      this.applyCachedSampleForZoom();
      return;
    }
    if (this.sampleTimer) clearTimeout(this.sampleTimer);
    if (debounceMs === 0) {
      void this.runSample();
    } else {
      this.sampleTimer = setTimeout(() => {
        this.sampleTimer = null;
        void this.runSample();
      }, debounceMs);
    }
  }

  private async runSample() {
    if (!this.currentStyle || !this.currentGeoBbox) return;
    // Cancel any prior sample that might still be in flight.
    this.sampleAbort?.abort();
    const ctrl = new AbortController();
    this.sampleAbort = ctrl;

    const targetZoom = this.maxZoom;
    const style = this.currentStyle;
    const bbox = bboxToArr(this.currentGeoBbox);

    try {
      // Resolve once per style — TileJSON and style.json fetches are stable.
      if (this.resolvedTileUrls === null) {
        this.resolvedTileUrls = await resolveDataTileUrls(style, ctrl.signal);
      }
      if (ctrl.signal.aborted) return;

      const avg = await sampleAvgTileBytes({
        tileUrls: this.resolvedTileUrls,
        bounds: bbox,
        maxzoom: targetZoom,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (avg != null) {
        this.sampleByZoom.set(targetZoom, avg);
        if (this.maxZoom === targetZoom) this.avgTileBytes = avg;
      }
    } catch {
      // swallow — fall back to the default constant
    }
  }

  private async resolveAsyncMaxZoom() {
    if (!this.currentStyle || !this.currentGeoBbox) return;
    this.maxZoomResolveAbort?.abort();
    const ctrl = new AbortController();
    this.maxZoomResolveAbort = ctrl;
    const max = await getStyleMaxZoomAsync(
      this.currentStyle,
      bboxToArr(this.currentGeoBbox),
      ctrl.signal,
    );
    if (ctrl.signal.aborted) return;
    if (max == null) return;
    const next = Math.min(MAX_ZOOM_LIMIT, max);
    if (next === this.effectiveMaxZoom) return;
    this.effectiveMaxZoom = next;
    if (this.maxZoom > next) this.maxZoom = next;
  }

  private buildNameDescFields(): TemplateResult {
    return html`
      <div class="dm-fields">
        <div>
          <label class="dm-label">Name</label>
          <input
            type="text"
            class="dm-input dm-name"
            placeholder="e.g. London — Hyde Park & Mayfair"
            .value=${this.name}
            @input=${(e: Event) =>
              (this.name = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div>
          <label class="dm-label">
            Description <span class="dm-label-aux">· optional</span>
          </label>
          <textarea
            class="dm-input dm-desc"
            rows="2"
            placeholder="Notes about what this package contains."
            .value=${this.desc}
            @input=${(e: Event) =>
              (this.desc = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>
      </div>
    `;
  }

  private buildBoundsRow(): TemplateResult {
    const g = this.currentGeoBbox;
    const wsen = g
      ? [g.west, g.south, g.east, g.north].map((n) => n.toFixed(4)).join(", ")
      : "—";
    return html`
      <div class="dm-bounds-row">
        <span class="dm-bounds-label">Bounds</span>
        <span class="dm-bounds-val">${wsen}</span>
      </div>
    `;
  }

  private estimateText(): string {
    return `${this.tileCount.toLocaleString()} tiles · ~${formatBytes(
      this.tileCount * this.bytesPerTile,
    )}`;
  }

  private buildEstimate(): TemplateResult {
    return html`
      <div class="dm-estimate">
        <span>Estimated</span>
        <span
          class=${classMap({
            "dm-estimate-val": true,
            "dm-estimate-provisional": !this.sizeIsFromSample,
          })}
          >${this.estimateText()}</span
        >
      </div>
    `;
  }

  private buildWarning(): TemplateResult | typeof nothing {
    const lvl = this.warnLevel;
    if (!lvl) return nothing;
    const icon = lvl === "huge" ? "⛔" : "⚠";
    const sizeStr = formatBytes(this.tileCount * this.bytesPerTile);
    const msg =
      lvl === "huge"
        ? html`Very large package —
            <b>${this.tileCount.toLocaleString()} tiles · ~${sizeStr}</b>.
            You'll be asked to confirm before downloading. Consider lowering max
            zoom or shrinking the area.`
        : html`Heads up — this package is large (~<b>${sizeStr}</b>). Make sure
            you're on Wi-Fi.`;
    return html`
      <div class="dm-warn dm-warn-${lvl}">
        <span class="dm-warn-icon">${icon}</span><span>${msg}</span>
      </div>
    `;
  }

  /** Usage-restrictions banner — always shown so the user sees how the basemap
   *  may be used. Attribution/restrictive styles additionally get the required
   *  acknowledgement checkbox, which gates the primary download button. */
  private buildLicenceBanner(): TemplateResult | typeof nothing {
    const style = this.currentStyle;
    if (!style) return nothing;
    return html`
      <div class="dm-licence">
        <div class="dm-licence-title">Usage restrictions</div>
        <div class="dm-licence-body">
          Review how this basemap may be used before downloading — you are
          responsible for complying with its terms.
        </div>
        ${this.buildUsageList(style)}
        ${this.needsAck
          ? html`
              <label class="dm-licence-check">
                <input
                  type="checkbox"
                  class="dm-licence-checkbox"
                  .checked=${this.acknowledged}
                  @change=${(e: Event) =>
                    (this.acknowledged = (
                      e.target as HTMLInputElement
                    ).checked)}
                />
                <span>
                  I'll comply with ${this.renderTermsLink(style)} when storing &
                  redistributing the downloaded tiles.
                </span>
              </label>
            `
          : nothing}
      </div>
    `;
  }

  /** "<style> terms of use" — a link when the source publishes terms, plain
   *  bold text otherwise. Stops click propagation so opening the link doesn't
   *  also toggle the acknowledgement checkbox. */
  private renderTermsLink(style: AppStyle): TemplateResult {
    const label = `${style.name}'s terms of use`;
    return style.termsUrl
      ? html`<a
          class="dm-licence-terms"
          href=${style.termsUrl}
          target="_blank"
          rel="noopener noreferrer"
          @click=${(e: Event) => e.stopPropagation()}
          >${label}</a
        >`
      : html`<b>${label}</b>`;
  }

  /** Offline / commercial / redistribution / attribution verdicts, each with a
   *  Material icon and a hover/focus tooltip carrying the detail text.
   *  Attribution is synthesised — every gated source requires it. */
  private buildUsageList(style: AppStyle): TemplateResult {
    const r = getRestrictions(style);
    const curated = style.restrictions != null;
    const rows: { label: string; verdict: UsageVerdict; note: string }[] = [
      { label: USAGE_ASPECT_LABELS.offline, ...r.offline },
      { label: USAGE_ASPECT_LABELS.commercial, ...r.commercial },
      { label: USAGE_ASPECT_LABELS.redistribution, ...r.redistribution },
      {
        label: "Attribution",
        verdict: curated ? "conditional" : "unknown",
        note: curated
          ? "This source must be credited wherever the map is shown."
          : "Not verified — confirm the provider's attribution requirement.",
      },
    ];
    return html`
      <div class="dm-usage">
        ${rows.map((row) => {
          const color = VERDICT_COLORS[row.verdict];
          return html`
            <div class="dm-usage-row">
              <svg
                class="dm-usage-icon"
                viewBox="0 0 24 24"
                style="fill:${color}"
                aria-hidden="true"
              >
                <path d=${VERDICT_ICON_PATHS[row.verdict]} />
              </svg>
              <span class="dm-usage-label">${row.label}</span>
              <span
                class="dm-usage-verdict"
                style="color:${color}"
                tabindex="0"
                aria-label=${`${VERDICT_LABELS[row.verdict]}. ${row.note}`}
              >
                ${VERDICT_LABELS[row.verdict]}
                <span class="dm-tip" aria-hidden="true">${row.note}</span>
              </span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private buildErrorBanner(): TemplateResult {
    return html`
      <div class="dm-warn dm-warn-hard">
        <span class="dm-warn-icon">⛔</span><span>${this.errorText ?? ""}</span>
      </div>
    `;
  }

  private buildProgress(): TemplateResult {
    const pct = Math.round(this.progress * 100);
    return html`
      <div class="dm-progress">
        <div class="dm-progress-row">
          <span>Downloading…</span>
          <span class="dm-progress-pct">${pct}%</span>
        </div>
        <div class="dm-progress-track">
          <div class="dm-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }

  private buildSuccess(): TemplateResult {
    return html`
      <div class="dm-success"><span>✓</span><span>Package saved.</span></div>
    `;
  }

  private onPrimaryClick = () => {
    if (this.status === "success") {
      this.close();
    } else if (this.status === "error") {
      this.startDownload();
    } else if (this.warnLevel === "huge") {
      this.openHugeConfirm();
    } else {
      this.startDownload();
    }
  };

  private buildPrimaryButton(): TemplateResult {
    const isDownloading = this.status === "downloading";
    const isHuge = this.status === "idle" && this.warnLevel === "huge";
    const disabled =
      isDownloading || (this.status === "idle" && !this.canStart);

    let label: string;
    if (this.status === "idle") {
      label = isHuge ? "Review & download…" : "Download package";
    } else if (this.status === "downloading") {
      label = `Downloading… ${Math.round(this.progress * 100)}%`;
    } else if (this.status === "error") {
      label = "Retry download";
    } else {
      label = "Done";
    }

    return html`
      <button
        class=${classMap({
          "dm-primary": true,
          "dm-primary-disabled": disabled,
          "dm-primary-error": this.status === "error",
          "dm-primary-success": this.status === "success",
          "dm-primary-huge": isHuge && !disabled,
        })}
        ?disabled=${disabled}
        @click=${this.onPrimaryClick}
      >
        ${isDownloading
          ? html`
              <svg class="dm-spin" width="14" height="14" viewBox="0 0 14 14">
                <circle cx="7" cy="7" r="5" fill="none"
                  stroke="rgba(255,255,255,.35)" stroke-width="2" />
                <path d="M12 7a5 5 0 0 0-5-5" fill="none" stroke="#fff"
                  stroke-width="2" stroke-linecap="round" />
              </svg>
              <span>${label}</span>
            `
          : label}
      </button>
    `;
  }

  /** Modal-on-modal confirmation gate for huge downloads. The user must type
   *  the rounded estimated size in MB before the override button enables.
   *  Kept imperative — body-appended, no shared reactive state. */
  private openHugeConfirm() {
    if (!this.canStart) return;
    this.closeHugeConfirm();
    const tiles = this.tileCount;
    const expected = String(Math.round(this.sizeMB));

    const backdrop = document.createElement("div");
    backdrop.className = "dm-huge-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) this.closeHugeConfirm();
    });

    const modal = document.createElement("div");
    modal.className = "dm-huge-modal";
    modal.innerHTML = `
      <div class="dm-huge-head">
        <div class="dm-huge-mark">⛔</div>
        <div>
          <div class="dm-huge-title">Are you really sure?</div>
          <div class="dm-huge-sub">This is much larger than typical.</div>
        </div>
      </div>
      <div class="dm-huge-stats">
        <span>Tiles</span><span class="dm-huge-stat-val">${tiles.toLocaleString()}</span>
        <span>Estimated size</span>
        <span class="dm-huge-stat-val dm-huge-stat-size">${expected} MB</span>
      </div>
      <div class="dm-huge-friction">
        <label class="dm-huge-label">Type the estimated size in MB to confirm</label>
        <div class="dm-huge-input-wrap">
          <input type="text" class="dm-huge-input" inputmode="numeric"
            autocomplete="off" spellcheck="false" placeholder="${expected}" />
          <span class="dm-huge-suffix">MB</span>
        </div>
        <button type="button" class="dm-huge-confirm" disabled>Download anyway</button>
      </div>
      <button type="button" class="dm-huge-cancel">Cancel</button>`;

    const input = modal.querySelector<HTMLInputElement>(".dm-huge-input")!;
    const confirmBtn = modal.querySelector<HTMLButtonElement>(
      ".dm-huge-confirm",
    )!;
    const sync = () => {
      const matched = input.value.trim() === expected;
      confirmBtn.disabled = !matched;
      input.classList.toggle("dm-huge-input-ok", matched);
    };
    input.addEventListener("input", sync);
    confirmBtn.addEventListener("click", () => {
      if (input.value.trim() !== expected) return;
      this.closeHugeConfirm();
      this.startDownload();
    });
    modal
      .querySelector<HTMLButtonElement>(".dm-huge-cancel")!
      .addEventListener("click", () => this.closeHugeConfirm());

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    this.hugeConfirmEl = backdrop;
    input.focus();
  }

  private closeHugeConfirm() {
    this.hugeConfirmEl?.remove();
    this.hugeConfirmEl = null;
  }

  private startDownload() {
    if (!this.currentStyle || !this.currentGeoBbox) return;
    this.status = "downloading";
    this.progress = 0;
    this.errorText = null;

    this.controller = this.opts.onDownload(
      {
        style: this.currentStyle,
        bbox: this.currentGeoBbox,
        maxZoom: this.maxZoom,
        name: this.name.trim() || "map",
        description: this.desc.trim(),
      },
      {
        onProgress: ({ fraction, done }) => {
          this.progress = Math.max(0, Math.min(1, fraction));
          if (done) {
            this.status = "success";
            this.progress = 1;
          }
        },
        onError: (msg) => {
          this.status = "error";
          this.errorText = msg;
        },
      },
    );
  }
}

if (!customElements.get("download-modal")) {
  customElements.define("download-modal", DownloadModal);
}

/** Format a byte count as KB / MB / GB. We avoid `0.0 MB` rounding for small
 *  but non-zero values (which the toFixed(1) approach used to produce). */
function formatBytes(bytes: number): string {
  if (bytes < 1) return "<1 KB";
  const KB = bytes / 1024;
  if (KB < 1024) {
    return KB < 10 ? `${KB.toFixed(1)} KB` : `${Math.round(KB)} KB`;
  }
  const MB = KB / 1024;
  if (MB < 1024) {
    return MB < 10 ? `${MB.toFixed(1)} MB` : `${Math.round(MB)} MB`;
  }
  const GB = MB / 1024;
  return GB < 10 ? `${GB.toFixed(2)} GB` : `${GB.toFixed(1)} GB`;
}
