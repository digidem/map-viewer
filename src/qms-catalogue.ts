import type {
  LicenseBucket,
  QmsStyle,
  StyleCategory,
  StyleTone,
} from "./preset-styles.ts";

// ─── QMS catalogue ──────────────────────────────────────────────────────────
//
// A curated, vendored snapshot of global basemaps from the NextGIS QMS
// catalogue (https://qms.nextgis.com). Each entry is a real QMS service (keyed
// by its real `qmsId`), hand-categorised into our four categories — the
// `category` field IS the categorisation mapping.
//
// This is deliberately a static dataset rather than a live API call:
//   • the live QMS `extent` metadata can't distinguish global basemaps from
//     regional ones (most global services store a null extent), so the
//     "global only" filter can't be derived at runtime;
//   • vendoring avoids a multi-page API round-trip every time the picker opens.
// All entries here are EPSG:3857 TMS services that were `works` when captured,
// and are curated to not duplicate the built-in presets.

export interface QmsCatalogueEntry {
  /** Real NextGIS QMS service id. */
  qmsId: number;
  name: string;
  desc: string;
  /** Raster {z}/{x}/{y} tile URL template. */
  url: string;
  tone: StyleTone;
  category: StyleCategory;
  /** Attribution HTML for the popover + download licence banner. */
  attribution: string;
  license: LicenseBucket;
  /** Link to the source's published terms of use. */
  termsUrl: string;
  /** Hand-tuned prominence used for the default sort (QMS has no popularity
   *  field of its own). Higher = nearer the top of the grid. */
  popularity: number;
}

const OSM_ATTR =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTR =
  'Map tiles by <a href="https://carto.com/attributions">CARTO</a> · ' + OSM_ATTR;
const ESRI_ATTR =
  'Tiles © <a href="https://www.esri.com">Esri</a> — sourced from Esri and its data partners';
const GOOGLE_ATTR =
  'Map data © <a href="https://www.google.com/maps">Google</a>';

const OSM_TERMS = "https://operations.osmfoundation.org/policies/tiles/";
const CARTO_TERMS = "https://carto.com/legal/";
const ESRI_TERMS =
  "https://www.esri.com/en-us/legal/terms/full-master-agreement";
const GOOGLE_TERMS = "https://www.google.com/permissions/geoguidelines/";

/** Curated global basemaps from the NextGIS QMS catalogue, pre-categorised. */
export const QMS_CATALOGUE: QmsCatalogueEntry[] = [
  // ── Street ────────────────────────────────────────────────────────────
  {
    qmsId: 448,
    name: "OpenStreetMap",
    desc: "The classic openstreetmap.org Mapnik raster style.",
    url: "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    tone: "light",
    category: "street",
    attribution: OSM_ATTR,
    license: "attribution",
    termsUrl: OSM_TERMS,
    popularity: 100,
  },
  {
    qmsId: 8754,
    name: "Carto Light All",
    desc: "Carto's neutral light basemap with labels.",
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    tone: "light",
    category: "street",
    attribution: CARTO_ATTR,
    license: "attribution",
    termsUrl: CARTO_TERMS,
    popularity: 88,
  },
  {
    qmsId: 2323,
    name: "Carto Voyager",
    desc: "Carto Voyager — subtle colour cues, full labels.",
    url: "https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png",
    tone: "light",
    category: "street",
    attribution: CARTO_ATTR,
    license: "attribution",
    termsUrl: CARTO_TERMS,
    popularity: 84,
  },
  {
    qmsId: 525,
    name: "Wikimedia Map",
    desc: "OSM-derived style used across Wikimedia projects.",
    url: "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png",
    tone: "light",
    category: "street",
    attribution: "Wikimedia maps · " + OSM_ATTR + " (CC-BY-SA)",
    license: "attribution",
    termsUrl: "https://foundation.wikimedia.org/wiki/Policy:Maps_Terms_of_Use",
    popularity: 78,
  },
  {
    qmsId: 510,
    name: "Esri Street Map",
    desc: "Esri World Street Map — multi-scale road reference.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    tone: "light",
    category: "street",
    attribution: ESRI_ATTR,
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    popularity: 64,
  },
  {
    qmsId: 462,
    name: "Esri Light Gray",
    desc: "Muted light-grey canvas — ideal under data overlays.",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    tone: "light",
    category: "street",
    attribution: ESRI_ATTR,
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    popularity: 60,
  },
  {
    qmsId: 480,
    name: "Esri Dark Gray",
    desc: "Muted dark-grey canvas for bright overlays.",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    tone: "dark",
    category: "street",
    attribution: ESRI_ATTR,
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    popularity: 58,
  },
  {
    qmsId: 1136,
    name: "Google Maps",
    desc: "Google's standard road map. Subject to Google's terms.",
    url: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    tone: "light",
    category: "street",
    attribution: GOOGLE_ATTR,
    license: "restrictive",
    termsUrl: GOOGLE_TERMS,
    popularity: 96,
  },

  // ── Satellite ─────────────────────────────────────────────────────────
  {
    qmsId: 678,
    name: "Google Satellite",
    desc: "Google's global satellite imagery. Subject to Google's terms.",
    // scale=2 serves genuinely higher-res (retina) imagery, not an upscale —
    // verified ~12x the high-freq detail of a bicubic upscale. ~4x the bytes.
    url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&scale=2",
    tone: "dark",
    category: "satellite",
    attribution: 'Imagery © <a href="https://www.google.com/maps">Google</a>',
    license: "restrictive",
    termsUrl: GOOGLE_TERMS,
    popularity: 90,
  },
  {
    qmsId: 1135,
    name: "Google Satellite Hybrid",
    desc: "Google satellite imagery with road & label overlay.",
    // scale=2 serves genuinely higher-res (retina) imagery plus 2x-rendered
    // labels — both crisp on retina, not an upscale. ~4x the tile bytes.
    url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&scale=2",
    tone: "dark",
    category: "satellite",
    attribution: 'Imagery © <a href="https://www.google.com/maps">Google</a>',
    license: "restrictive",
    termsUrl: GOOGLE_TERMS,
    popularity: 86,
  },

  // ── Topographic ───────────────────────────────────────────────────────
  {
    qmsId: 477,
    name: "Esri Ocean Basemap",
    desc: "Bathymetric basemap with seafloor features.",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR + ", GEBCO, NOAA",
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    popularity: 40,
  },
  {
    qmsId: 1140,
    name: "Google Terrain",
    desc: "Google's terrain map with relief shading.",
    url: "https://mt1.google.com/vt/lyrs=t&x={x}&y={y}&z={z}",
    tone: "light",
    category: "terrain",
    attribution: GOOGLE_ATTR,
    license: "restrictive",
    termsUrl: GOOGLE_TERMS,
    popularity: 62,
  },
  {
    qmsId: 7652,
    name: "NextGIS Terrarium",
    desc: "RGB-encoded elevation tiles (Terrarium scheme).",
    url: "https://terrarium.nextgis.ru/{z}/{x}/{y}.png",
    tone: "dark",
    category: "terrain",
    attribution: 'Terrain tiles hosted by <a href="https://nextgis.com">NextGIS</a>',
    license: "open",
    termsUrl: "https://nextgis.com/",
    popularity: 30,
  },
];

/** Translate a QMS catalogue entry into an in-app style. */
export function qmsToStyle(entry: QmsCatalogueEntry): QmsStyle {
  return {
    id: `qms-${entry.qmsId}`,
    qmsId: entry.qmsId,
    name: entry.name,
    desc: entry.desc,
    url: entry.url,
    kind: "raster",
    tone: entry.tone,
    category: entry.category,
    attribution: entry.attribution,
    license: entry.license,
    termsUrl: entry.termsUrl,
  };
}
