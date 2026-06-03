import type { StyleSpecification } from "maplibre-gl";

export type StyleKind = "vector" | "raster";
export type StyleTone = "light" | "dark";
export type StyleCategory = "street" | "satellite" | "terrain";
export type LicenseBucket = "open" | "attribution" | "restrictive";
/** Tile y-axis convention for raster sources. `xyz` = y grows downward
 *  (Google/OSM); `tms` = y grows upward (OGC TMS). */
export type TileScheme = "xyz" | "tms";

export interface StyleCategoryDef {
  id: StyleCategory;
  label: string;
}

export const PRESET_CATEGORIES: StyleCategoryDef[] = [
  { id: "street", label: "Street" },
  { id: "satellite", label: "Satellite" },
  { id: "terrain", label: "Topographic" },
];

export const LICENSE_LABELS: Record<LicenseBucket, string> = {
  open: "Open",
  attribution: "Attribution",
  restrictive: "Restricted",
};

/** Dot/pill colours for each licence bucket, shared by the picker cards, the
 *  attribution popover, and the download-modal banner. */
export const LICENSE_COLORS: Record<LicenseBucket, string> = {
  open: "#1f7f3a",
  attribution: "#a06a10",
  restrictive: "#a83a3a",
};

/** The usage questions every basemap is checked against. Chosen for what
 *  actually matters in a tile-downloading app: can tiles be taken offline,
 *  can the resulting map be used commercially, and can the downloaded package
 *  be shared on to other people. */
export type UsageAspect = "offline" | "commercial" | "redistribution";

/** A source's stance on one usage aspect. `unknown` = we couldn't verify it. */
export type UsageVerdict = "allowed" | "conditional" | "prohibited" | "unknown";

export interface UsageRestriction {
  verdict: UsageVerdict;
  /** One short, source-specific sentence explaining the verdict. */
  note: string;
}

export type UsageRestrictions = Record<UsageAspect, UsageRestriction>;

/** Render order for the three aspects. */
export const USAGE_ASPECTS: UsageAspect[] = [
  "offline",
  "commercial",
  "redistribution",
];

export const USAGE_ASPECT_LABELS: Record<UsageAspect, string> = {
  offline: "Offline download",
  commercial: "Commercial use",
  redistribution: "Redistribution",
};

export const VERDICT_LABELS: Record<UsageVerdict, string> = {
  allowed: "Allowed",
  conditional: "Conditional",
  prohibited: "Not allowed",
  unknown: "Unverified",
};

/** Verdict colours — high-contrast green / orange / red so the three states
 *  are easy to tell apart at a glance; grey marks an unverified source. */
export const VERDICT_COLORS: Record<UsageVerdict, string> = {
  allowed: "#137333",
  conditional: "#e65100",
  prohibited: "#c62828",
  unknown: "#5f6368",
};

/** Material Design icon (filled, 24×24 viewBox) for each verdict — paired with
 *  VERDICT_COLORS so the state reads from both shape and colour. */
export const VERDICT_ICON_PATHS: Record<UsageVerdict, string> = {
  // check_circle
  allowed:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  // warning
  conditional: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  // block
  prohibited:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z",
  // help
  unknown:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z",
};

export const CATEGORY_LABELS: Record<StyleCategory, string> =
  Object.fromEntries(PRESET_CATEGORIES.map((c) => [c.id, c.label])) as Record<
    StyleCategory,
    string
  >;

export interface PresetStyle {
  id: string;
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone: StyleTone;
  category: StyleCategory;
  /** Attribution HTML rendered in the map's attribution popover and the
   *  download-modal licence banner. */
  attribution: string;
  /** Licence bucket — drives the download-modal acknowledgement gate. */
  license: LicenseBucket;
  /** Per-aspect usage restrictions (offline download, commercial use,
   *  redistribution) surfaced in the attribution popover and download modal. */
  restrictions: UsageRestrictions;
  /** Link to the source's published terms of use. Surfaced in the attribution
   *  popover and the download-modal licence banner. */
  termsUrl?: string;
  /** Raster tile scheme. Defaults to "xyz" when unset. */
  scheme?: TileScheme;
  /** Native max zoom of the underlying tile source — the deepest zoom at which
   *  the source has real data, not server-side overzoomed tiles. Caps the
   *  downloader's max-zoom slider and the generated style's source `maxzoom`,
   *  so we never store upsampled tiles MapLibre would overzoom for free. */
  maxZoom?: number;
  /** Values for a `{subdomain}` placeholder in the URL (e.g. Bing's t0–t3).
   *  Defaults to a/b/c when unset. */
  subdomains?: string[];
  /** Zoom for the picker preview tile. Defaults to a city-level zoom; lower it
   *  for sources whose tiles are sparse/placeholder at higher zoom. */
  previewZoom?: number;
  /** Raster tile URL template (with {z}/{x}/{y}) used to render a single-tile
   *  preview thumbnail in the style picker. For raster sources this is just the
   *  source URL; for vector styles, it points to a hand-picked raster basemap
   *  with a similar look. */
  previewTileUrl: string;
  /** Pre-built MapLibre style spec, for styles that aren't a single tile URL
   *  or style.json (e.g. a hillshade rendered over a raster-DEM source). */
  spec?: StyleSpecification;
}

export interface CustomStyle {
  id: "custom";
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone?: StyleTone;
  /** When set, the style is a fully-formed maplibre style spec (e.g. raster wrapper for tile URLs). */
  spec?: StyleSpecification;
  accessToken?: string;
  /** Set when the picker could resolve a max zoom synchronously (e.g. from a
   *  TileJSON during validate). Otherwise the modal resolves it at open time. */
  maxZoom?: number;
  /** Tile scheme chosen in the Custom URL panel for tile-template sources. */
  scheme?: TileScheme;
  /** Always present so the attribution popover has something to show. Custom
   *  URLs default to a "verify the licence yourself" message. */
  attribution: string;
  /** Custom URLs default to "restrictive" — we can't vouch for the source. */
  license: LicenseBucket;
  /** Absent for custom URLs — `getRestrictions` falls back to UNKNOWN_RESTRICTIONS. */
  restrictions?: UsageRestrictions;
  termsUrl?: string;
}

export interface MbtilesStyle {
  id: "mbtiles";
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone?: StyleTone;
  isMbtiles: true;
  /** maplibre style for displaying the loaded mbtiles via the mbtiles:// protocol */
  spec: StyleSpecification;
  /** Max zoom from the mbtiles file's metadata. */
  maxZoom?: number;
  attribution: string;
  license: LicenseBucket;
  /** Absent for loaded files — `getRestrictions` falls back to UNKNOWN_RESTRICTIONS. */
  restrictions?: UsageRestrictions;
  termsUrl?: string;
}

/** A style picked from the NextGIS QMS catalogue. */
export interface QmsStyle {
  /** App-side id, `qms-${qmsId}`. */
  id: string;
  /** NextGIS QMS service id. */
  qmsId: number;
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone: StyleTone;
  category: StyleCategory;
  attribution: string;
  license: LicenseBucket;
  /** Absent for QMS catalogue entries — `getRestrictions` falls back to UNKNOWN_RESTRICTIONS. */
  restrictions?: UsageRestrictions;
  termsUrl?: string;
  scheme?: TileScheme;
  /** Values for a `{subdomain}` placeholder in the URL (e.g. Google's mt0–mt3). */
  subdomains?: string[];
}

export type AppStyle = PresetStyle | CustomStyle | MbtilesStyle | QmsStyle;

/** Safe fallback attribution for a user-pasted custom URL. */
export const CUSTOM_URL_ATTRIBUTION =
  "Custom user-provided source — verify licence with the provider.";

/** Usage restrictions for sources we can't vouch for — custom URLs, QMS
 *  catalogue entries, and loaded .mbtiles files. */
export const UNKNOWN_RESTRICTIONS: UsageRestrictions = {
  offline: {
    verdict: "unknown",
    note: "Not verified — check the provider's terms before downloading tiles.",
  },
  commercial: {
    verdict: "unknown",
    note: "Not verified — check the provider's terms before any commercial use.",
  },
  redistribution: {
    verdict: "unknown",
    note: "Not verified — check the provider's terms before sharing the package.",
  },
};

/** A style's usage restrictions, falling back to UNKNOWN_RESTRICTIONS when the
 *  source carries no curated licence data. */
export function getRestrictions(style: AppStyle): UsageRestrictions {
  return style.restrictions ?? UNKNOWN_RESTRICTIONS;
}

const OFM_ATTR =
  '© <a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const OFM_TERMS = "https://openfreemap.org/";
const ESRI_TERMS =
  "https://www.esri.com/en-us/legal/terms/full-master-agreement";
const ESRI_ATTR = (sources: string) =>
  `Tiles © <a href="https://www.esri.com">Esri</a> — Source: ${sources}`;

/** OpenFreeMap: permissive — no request limits, full-planet downloads
 *  published, commercial use allowed. Shared by all five OFM presets. */
const OFM_RESTRICTIONS: UsageRestrictions = {
  offline: {
    verdict: "allowed",
    note: "OpenFreeMap sets no request limits and publishes full-planet downloads — caching tiles for offline use is sanctioned.",
  },
  commercial: {
    verdict: "allowed",
    note: "Commercial use is explicitly permitted, free of charge.",
  },
  redistribution: {
    verdict: "conditional",
    note: "Allowed, but the bundled OpenStreetMap data stays under ODbL — keep attribution and share-alike on any derived data.",
  },
};

/** Esri / ArcGIS Online basemaps: the Master Agreement only permits offline
 *  basemaps via official Content Packages inside licensed ArcGIS apps, with no
 *  licence grant for anonymous tile access. Shared by all Esri presets. */
const ESRI_RESTRICTIONS: UsageRestrictions = {
  offline: {
    verdict: "prohibited",
    note: "Esri's Master Agreement only allows offline basemaps via official Content Packages inside licensed ArcGIS apps — bulk-downloading tiles into a package is not permitted.",
  },
  commercial: {
    verdict: "prohibited",
    note: "Anonymous tile access carries no Esri licence; commercial use requires a paid ArcGIS subscription.",
  },
  redistribution: {
    verdict: "prohibited",
    note: "Esri's terms forbid redistributing its content or giving third parties access to it.",
  },
};

const BING_RESTRICTIONS: UsageRestrictions = {
  offline: {
    verdict: "prohibited",
    note: "Microsoft's terms forbid copying, storing or archiving Bing Maps content.",
  },
  commercial: {
    verdict: "conditional",
    note: "Commercial use needs a paid Bing Maps agreement; the free tier is capped and non-production.",
  },
  redistribution: {
    verdict: "prohibited",
    note: "Redistributing, reselling or sublicensing Bing Maps content is forbidden.",
  },
};

/** Hand-picked "Curated" set — the styles shown when the Curated chip is on.
 *  Trim or extend this list to change the curated gallery. */
export const CURATED_PRESET_IDS = new Set<string>([
  "bright",
  "liberty",
  "positron",
  "satellite",
  "sentinel2",
  "glad-landsat",
  "esri-topo",
  "esri-shaded-relief",
  "humanitarian",
]);

/** Mapterhorn publishes open raster-DEM terrain tiles (Copernicus GLO-30,
 *  global to z12). Rendered here as a hillshade over an OSM raster base —
 *  raster-DEM isn't a single tile URL, so this preset carries a full spec. */
const MAPTERHORN_SPEC: StyleSpecification = {
  version: 8,
  sources: {
    "mapterhorn-osm": {
      type: "raster",
      tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
    },
    "mapterhorn-dem": {
      type: "raster-dem",
      tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],
      encoding: "terrarium",
      tileSize: 512,
      maxzoom: 12,
    },
  },
  layers: [
    { id: "osm", type: "raster", source: "mapterhorn-osm" },
    {
      id: "hillshade",
      type: "hillshade",
      source: "mapterhorn-dem",
      paint: { "hillshade-shadow-color": "#473b24" },
    },
  ],
};

export const PRESET_STYLES: PresetStyle[] = [
  // ── Street ──────────────────────────────────────────────────────────────
  {
    id: "positron",
    name: "Positron",
    desc: "Carto-style minimal light basemap. Best for overlays.",
    url: "https://tiles.openfreemap.org/styles/positron",
    restrictions: OFM_RESTRICTIONS,
    kind: "vector",
    // OpenFreeMap planet vector tiles — TileJSON maxzoom 14.
    maxZoom: 14,
    tone: "light",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl:
      "https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png",
  },
  {
    id: "liberty",
    name: "OSM Liberty",
    desc: "Full-color OpenStreetMap vector style.",
    url: "https://tiles.openfreemap.org/styles/liberty",
    restrictions: OFM_RESTRICTIONS,
    kind: "vector",
    // OpenFreeMap planet vector tiles — TileJSON maxzoom 14.
    maxZoom: 14,
    tone: "light",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
  {
    id: "bright",
    name: "OSM Bright",
    desc: "High-contrast bright map. Strong type and roads.",
    url: "https://tiles.openfreemap.org/styles/bright",
    restrictions: OFM_RESTRICTIONS,
    kind: "vector",
    // OpenFreeMap planet vector tiles — TileJSON maxzoom 14.
    maxZoom: 14,
    tone: "light",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl:
      "https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png",
  },
  {
    id: "dark",
    name: "Dark Matter",
    desc: "Dark monochrome basemap. Good under bright overlays.",
    url: "https://tiles.openfreemap.org/styles/dark",
    restrictions: OFM_RESTRICTIONS,
    kind: "vector",
    // OpenFreeMap planet vector tiles — TileJSON maxzoom 14.
    maxZoom: 14,
    tone: "dark",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl:
      "https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
  },
  {
    id: "fiord",
    name: "Fiord",
    desc: "Muted blue-grey OpenFreeMap basemap.",
    url: "https://tiles.openfreemap.org/styles/fiord",
    restrictions: OFM_RESTRICTIONS,
    kind: "vector",
    // OpenFreeMap planet vector tiles — TileJSON maxzoom 14.
    maxZoom: 14,
    tone: "dark",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl:
      "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  },

  // ── Satellite ───────────────────────────────────────────────────────────
  {
    id: "satellite",
    name: "Esri Satellite",
    desc: "Esri World Imagery. Raster, global coverage.",
    // World Imagery has consistent global coverage to ~z19; z20+ is patchy.
    maxZoom: 19,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    restrictions: ESRI_RESTRICTIONS,
    kind: "raster",
    tone: "dark",
    category: "satellite",
    attribution: ESRI_ATTR(
      "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    ),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-clarity",
    name: "Esri Clarity",
    desc: "Sharpened recent imagery emphasising structures.",
    maxZoom: 19,
    url: "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    restrictions: ESRI_RESTRICTIONS,
    kind: "raster",
    tone: "dark",
    category: "satellite",
    attribution: ESRI_ATTR("Esri Clarity — Maxar Vivid"),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "sentinel2",
    name: "Sentinel-2 Cloudless",
    desc: "Cloud-free composite from EOX. Global, recent.",
    // Sentinel-2 is 10 m/px — native to z14. EOX serves z15-18 but overzoomed.
    maxZoom: 14,
    // EOX serves the same data on two hosts. `s2maps-tiles.eu` is fronted by
    // Cloudflare with a 403 wall; `tiles.maps.eox.at` returns proper CORS.
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
    restrictions: {
      offline: {
        verdict: "conditional",
        note: "Permitted, but cached tiles stay bound to the 2024 layer's CC BY-NC-SA 4.0 licence.",
      },
      commercial: {
        verdict: "prohibited",
        note: "The 2024 layer is CC BY-NC-SA 4.0 — non-commercial only; commercial use needs a paid EOX licence.",
      },
      redistribution: {
        verdict: "conditional",
        note: "Allowed only if the shared package keeps the same CC BY-NC-SA 4.0 terms (share-alike, non-commercial).",
      },
    },
    kind: "raster",
    tone: "dark",
    category: "satellite",
    attribution:
      'Sentinel-2 cloudless — <a href="https://s2maps.eu">s2maps.eu</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data)',
    license: "attribution",
    termsUrl: "https://s2maps.eu/",
    previewTileUrl:
      "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
  },
  {
    id: "nimbo",
    name: "NIMBO",
    desc: "Cloud-free Sentinel-2 mosaic, free for non-commercial use.",
    // Sentinel-2 mosaic — 10 m/px, native to z14; higher tiles are overzoomed.
    maxZoom: 14,
    // NIMBO's free MapCache layer is served as an OGC TMS (y-axis up).
    url: "https://prod-data.nimbo.earth/mapcache-free/tms/1.0.0/latest@kermap/{z}/{x}/{y}.png",
    restrictions: {
      offline: {
        verdict: "prohibited",
        note: "NIMBO's free terms forbid copying, downloading or saving the imagery in any form.",
      },
      commercial: {
        verdict: "prohibited",
        note: "The free licence is limited to non-commercial and research use.",
      },
      redistribution: {
        verdict: "prohibited",
        note: "Distributing, selling or transferring the imagery to third parties is forbidden.",
      },
    },
    kind: "raster",
    tone: "dark",
    category: "satellite",
    scheme: "tms",
    attribution:
      'Imagery © <a href="https://nimbo.earth">NIMBO</a> by KERMAP · Contains modified Copernicus Sentinel-2 data',
    license: "restrictive",
    termsUrl: "https://nimbo.earth/earth-online/terms-of-use/",
    previewTileUrl:
      "https://prod-data.nimbo.earth/mapcache-free/tms/1.0.0/latest@kermap/{z}/{x}/{y}.png",
  },
  {
    id: "glad-landsat",
    name: "GLAD Landsat",
    desc: "GLAD seasonal Landsat composites for vegetation analysis.",
    // Landsat is 30 m/px — tiles stop at z12 (z13 returns 404).
    maxZoom: 12,
    url: "https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_v1.12/last_543/{z}/{x}/{y}.jpg",
    restrictions: {
      offline: {
        verdict: "allowed",
        note: "The Global Forest Change dataset is CC BY 4.0 — copying and storing tiles is permitted.",
      },
      commercial: {
        verdict: "allowed",
        note: "CC BY 4.0 permits use for any purpose, including commercial.",
      },
      redistribution: {
        verdict: "allowed",
        note: "CC BY 4.0 allows redistributing the package, as long as attribution is kept.",
      },
    },
    kind: "raster",
    tone: "dark",
    category: "satellite",
    attribution:
      '© <a href="https://glad.umd.edu">GLAD, University of Maryland</a> · Landsat data courtesy of USGS',
    license: "attribution",
    termsUrl: "https://glad.umd.edu/",
    previewTileUrl:
      "https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_v1.12/last_543/{z}/{x}/{y}.jpg",
  },
  {
    id: "bing-satellite",
    name: "Bing Satellite",
    desc: "Microsoft Bing global aerial imagery. Subject to Microsoft's terms.",
    // Bing Aerial has consistent global coverage to z19; z20+ is patchy.
    maxZoom: 19,
    url: "https://ecn.{subdomain}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1",
    restrictions: BING_RESTRICTIONS,
    kind: "raster",
    tone: "dark",
    category: "satellite",
    subdomains: ["t0", "t1", "t2", "t3"],
    attribution:
      'Imagery © <a href="https://www.microsoft.com/maps">Microsoft</a> · Earthstar Geographics SIO',
    license: "restrictive",
    termsUrl: "https://www.microsoft.com/maps/product/terms.html",
    previewTileUrl:
      "https://ecn.{subdomain}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=1",
  },
  {
    id: "bing-hybrid",
    name: "Bing Satellite Hybrid",
    desc: "Bing aerial imagery with road & label overlay. Subject to Microsoft's terms.",
    // Bing Aerial has consistent global coverage to z19; z20+ is patchy.
    maxZoom: 19,
    // `h` = hybrid (aerial + labels); `a` is aerial-only, `r` road-only.
    url: "https://ecn.{subdomain}.tiles.virtualearth.net/tiles/h{quadkey}.jpeg?g=1",
    restrictions: BING_RESTRICTIONS,
    kind: "raster",
    tone: "dark",
    category: "satellite",
    subdomains: ["t0", "t1", "t2", "t3"],
    attribution:
      'Imagery © <a href="https://www.microsoft.com/maps">Microsoft</a> · Earthstar Geographics SIO',
    license: "restrictive",
    termsUrl: "https://www.microsoft.com/maps/product/terms.html",
    previewTileUrl:
      "https://ecn.{subdomain}.tiles.virtualearth.net/tiles/h{quadkey}.jpeg?g=1",
  },

  // ── Topographic ─────────────────────────────────────────────────────────
  {
    id: "esri-topo",
    name: "Esri Topographic",
    desc: "Esri World Topographic — contours, hillshade, labels.",
    // Esri's cartography stops adding detail past z19; deeper tiles overzoom.
    maxZoom: 19,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    restrictions: ESRI_RESTRICTIONS,
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR(
      "Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors",
    ),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "hillshade",
    name: "Hillshade",
    desc: "Greyscale relief-only. Ideal as a contour underlay.",
    // Derived from a global ~10-30 m DEM — relief detail flattens out past z16.
    maxZoom: 16,
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    restrictions: ESRI_RESTRICTIONS,
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR("derived from SRTM, ASTER GDEM, GEBCO, and others"),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-shaded-relief",
    name: "Esri Shaded Relief",
    desc: "Colour-graded shaded relief with elevation tinting.",
    // Esri only caches this service to z13.
    maxZoom: 13,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    restrictions: ESRI_RESTRICTIONS,
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR("ESRI, NGA, DeLorme"),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-terrain-base",
    name: "Esri Terrain Base",
    desc: "Minimal terrain backdrop — bathymetry + landcover only.",
    // Esri only caches this service to z13.
    maxZoom: 13,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
    restrictions: ESRI_RESTRICTIONS,
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR("USGS, Esri, TANA, DeLorme, NPS"),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    // World Terrain Base has no tile data past low zooms — preview lower so the
    // card doesn't show Esri's "Map data not yet available" placeholder.
    previewZoom: 8,
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-natgeo",
    name: "Esri National Geographic",
    desc: "National Geographic World Map — cartographic, illustrative.",
    // Esri only caches this service to z16.
    maxZoom: 16,
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
    restrictions: ESRI_RESTRICTIONS,
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution:
      'Map © <a href="https://www.esri.com">Esri</a> & <a href="https://www.nationalgeographic.com">National Geographic</a>',
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "mapterhorn",
    name: "Mapterhorn",
    desc: "Open terrain hillshade (Copernicus GLO-30) over an OSM base.",
    url: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp",
    restrictions: {
      offline: {
        verdict: "allowed",
        note: "Mapterhorn publishes area-extract downloads — offline use of the terrain tiles is intended.",
      },
      commercial: {
        verdict: "allowed",
        note: "The terrain data (Copernicus GLO-30) and code are openly licensed with no commercial restriction.",
      },
      redistribution: {
        verdict: "conditional",
        note: "Allowed, provided the package carries the required Copernicus DEM and source attributions.",
      },
    },
    kind: "raster",
    tone: "light",
    category: "terrain",
    spec: MAPTERHORN_SPEC,
    attribution:
      'Terrain © <a href="https://mapterhorn.com">Mapterhorn</a> (Copernicus GLO-30) · ' +
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    license: "attribution",
    termsUrl: "https://mapterhorn.com",
    previewTileUrl: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  },
];

/** Compute XYZ tile indices for a lng/lat at zoom z. */
export function lngLatToTile(
  lng: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05, Math.min(85.05, lat));
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(
    ((1 -
      Math.log(
        Math.tan((clampedLat * Math.PI) / 180) +
          1 / Math.cos((clampedLat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      n,
  );
  return {
    x: ((x % n) + n) % n,
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

const DEFAULT_SUBDOMAINS = ["a", "b", "c"];
const SUBDOMAIN_RE = /\{subdomain\}|\{s\}/;
const SUBDOMAIN_RE_G = /\{subdomain\}|\{s\}/g;

/** Substitute z/x/y/quadkey/subdomain placeholders in a tile URL template.
 *  Picks a subdomain deterministically from `(x + y) % subdomains.length`
 *  (same pattern Leaflet uses) so adjacent tiles spread across hosts. */
export function fillTileUrl(
  template: string,
  z: number,
  x: number,
  y: number,
  subdomains?: string[],
): string {
  let url = template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
  if (url.includes("{quadkey}")) {
    url = url.replace(/\{quadkey\}/g, computeQuadkey(z, x, y));
  }
  if (SUBDOMAIN_RE.test(url)) {
    const subs = subdomains?.length ? subdomains : DEFAULT_SUBDOMAINS;
    url = url.replace(SUBDOMAIN_RE_G, subs[(x + y) % subs.length]);
  }
  return url;
}

/** Bing-style quadkey for an XYZ tile. Empty string at z=0. */
export function computeQuadkey(z: number, x: number, y: number): string {
  let key = "";
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    key += (x & mask ? 1 : 0) + (y & mask ? 2 : 0);
  }
  return key;
}

/** True if the URL is a tile template — it contains `{z}`, `{x}` and `{y}`
 *  placeholders (in any order; some providers such as Google put `{z}` last)
 *  or a Bing-style `{quadkey}` placeholder. */
export function isTileUrlTemplate(url: string): boolean {
  if (url.includes("{quadkey}")) return true;
  return url.includes("{z}") && url.includes("{x}") && url.includes("{y}");
}

export function hasSubdomainPlaceholder(url: string): boolean {
  return SUBDOMAIN_RE.test(url);
}

/** Expand `{subdomain}` / `{s}` into one URL per subdomain. The SMP downloader
 *  and MapLibre both cycle through a `tiles[]` array, so this is the standard
 *  way to provide per-host load-balanced templates. */
export function expandSubdomainTiles(
  tileUrl: string,
  subdomains?: string[],
): string[] {
  if (!SUBDOMAIN_RE.test(tileUrl)) return [tileUrl];
  const subs = subdomains?.length ? subdomains : DEFAULT_SUBDOMAINS;
  return subs.map((s) => tileUrl.replace(SUBDOMAIN_RE_G, s));
}

/** Build a basic raster maplibre style for a tile URL template (z/x/y or
 *  quadkey). When the template contains `{subdomain}`/`{s}`, expand into one
 *  URL per subdomain so MapLibre can round-robin. The `scheme` controls the
 *  y-axis convention (xyz vs OGC tms). `maxZoom`, when known, is set as the
 *  source `maxzoom` so MapLibre overzooms past it instead of requesting
 *  upsampled tiles — and so the SMP downloader stops fetching at that zoom. */
export function rasterStyleForTileUrl(
  tileUrl: string,
  subdomains?: string[],
  scheme: TileScheme = "xyz",
  maxZoom?: number,
): StyleSpecification {
  return {
    version: 8,
    sources: {
      tiles: {
        type: "raster",
        tiles: expandSubdomainTiles(tileUrl, subdomains),
        tileSize: 256,
        scheme,
        ...(maxZoom != null ? { maxzoom: maxZoom } : {}),
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#e9e7e1" },
      },
      {
        id: "tiles",
        type: "raster",
        source: "tiles",
      },
    ],
  };
}

/** Build a maplibre style for a TileJSON URL. The source `url` field
 *  triggers maplibre to fetch & inline the TileJSON automatically. */
export function styleForTileJson(
  tileJsonUrl: string,
  kind: StyleKind,
): StyleSpecification {
  if (kind === "vector") {
    return {
      version: 8,
      sources: {
        src: { type: "vector", url: tileJsonUrl },
      },
      // No layer styling — viewing a TileJSON without a style is rarely useful,
      // but at least the user can see the map area for the bbox flow.
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#f5f4ee" },
        },
      ],
    };
  }
  return {
    version: 8,
    sources: {
      src: { type: "raster", url: tileJsonUrl, tileSize: 256 },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#e9e7e1" },
      },
      { id: "src", type: "raster", source: "src" },
    ],
  };
}

/** Resolve an AppStyle to something MapLibre's `setStyle` can accept. */
export function buildMapStyle(style: AppStyle): string | StyleSpecification {
  if ("spec" in style && style.spec) return style.spec;
  if (isTileUrlTemplate(style.url)) {
    return rasterStyleForTileUrl(
      style.url,
      "subdomains" in style ? style.subdomains : undefined,
      "scheme" in style ? style.scheme : undefined,
      "maxZoom" in style ? style.maxZoom : undefined,
    );
  }
  return style.url;
}
