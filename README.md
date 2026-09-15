# Map Viewer

Map Viewer is an offline-first web app for viewing
[MBTiles](https://github.com/mapbox/mbtiles-spec) and
[Styled Map Package](https://github.com/digidem/styled-map-package) (.smp)
files. Open a file with the button or drag and drop it onto the page. Files are
never uploaded: everything happens in your browser, and the site can be
installed as a PWA on desktop and mobile so it keeps working offline.

It is a companion to [Map Downloader](https://map-downloader.comapeo.app), which
creates SMP files for [CoMapeo](https://comapeo.app).

## Supported files

**MBTiles** (`.mbtiles`, `.sqlite`, `.db`) are copied to
[OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
and queried with [sqlite-wasm](https://github.com/sqlite/sqlite-wasm). Raster
tilesets are shown as-is; vector tiles are rendered with random colours,
borrowing ideas from [mbview](https://github.com/mapbox/mbview).

**Styled Map Packages** (`.smp`) are read directly from the file with
[styled-map-package-api](https://github.com/digidem/styled-map-package), so
there is no copy step. The package's own style, glyphs and sprites are used, and
the area the package covers is outlined on the map.

## Export to SMP

Once an MBTiles file is loaded, click the download button (arrow icon, top
right) to export it as a Styled Map Package. The SMP is generated in a web
worker and streamed as a download via a service worker, so even large files
don't need to be held entirely in memory.

## Caveats

MBTiles files are copied into OPFS so that sqlite-wasm can query them. This copy
is removed when you leave the page, or the next time you open the page or app.
Browsers do not currently provide a way to browse files in OPFS.

## Development

```bash
npm install
npm run dev
```

The e2e tests use Playwright (Chromium and Firefox) driven from Vitest:

```bash
npm run test:e2e:install
npm test
```

PWA icons are generated from `public/logo.svg`:

```bash
npm run generate-pwa-assets
```

## Deployment

```bash
npm run build
npm run preview # preview locally
```

The contents of `dist` can be served by any host that applies the headers in
`public/_headers` (cross-origin isolation is required for OPFS and
sqlite-wasm).

## License

MIT
