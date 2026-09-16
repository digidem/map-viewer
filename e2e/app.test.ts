import fs from "fs";
import path from "path";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type Page,
} from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const fixturePath = path.resolve("e2e/fixtures/plain_1.mbtiles");
const vectorFixturePath = path.resolve("e2e/fixtures/vector_1.mbtiles");
const smpFixturePath = path.resolve("e2e/fixtures/plain_1.smp");
// Named .bin because *.sqlite is commonly gitignored; the app sniffs headers, not extensions
const notMbtilesPath = path.resolve("e2e/fixtures/not-mbtiles-sqlite.bin");
const baseUrl = "http://localhost:4174";

const chromiumArgs =
  process.platform === "darwin"
    ? ["--use-gl=angle", "--use-angle=metal"]
    : ["--use-gl=angle", "--use-angle=swiftshader"];

/** Open a map file via the file picker and wait for the map to render */
async function openMapFile(page: Page, filePath = fixturePath) {
  await page.goto(baseUrl);
  await page.locator("#open-button").waitFor({ state: "visible" });

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#open-button").click(),
  ]);
  await fileChooser.setFiles(filePath);

  const map = page.locator("#map");
  await map.waitFor({ state: "visible", timeout: 30_000 });

  const canvas = map.locator("canvas");
  await canvas.waitFor({ state: "attached", timeout: 10_000 });
}

/** Dispatch a synthetic drop of the given bytes onto the document */
async function dropFile(page: Page, bytes: Uint8Array, fileName: string) {
  await page.evaluate(
    async ({ bytes, fileName }) => {
      const file = new File([new Uint8Array(bytes)], fileName);
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      document.dispatchEvent(
        new DragEvent("dragenter", { dataTransfer, bubbles: true }),
      );
      document.dispatchEvent(
        new DragEvent("drop", { dataTransfer, bubbles: true }),
      );
    },
    { bytes: Array.from(bytes), fileName },
  );
}

async function waitForLayer(page: Page, layerId: string) {
  await page.waitForFunction(
    (id) => Boolean((window as any).maplibreMap?.getLayer(id)),
    layerId,
    { timeout: 30_000 },
  );
}

function appTests(
  browserType: BrowserType,
  launchOptions?: Record<string, unknown>,
  opts?: { skipDownloadTest?: boolean },
) {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await browserType.launch({
      headless: true,
      ...launchOptions,
    });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("shows the open button on load", async () => {
    await page.goto(baseUrl);
    const button = page.locator("#open-button");
    await button.waitFor({ state: "visible" });
    expect(await button.isEnabled()).toBe(true);
  });

  test("shows drag-and-drop hint text on load", async () => {
    await page.goto(baseUrl);
    const hint = page.locator("#drop-hint");
    await hint.waitFor({ state: "visible" });
    expect(await hint.textContent()).toContain("drag");
  });

  test("shows drop overlay on dragenter and hides on dragleave", async () => {
    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });

    const overlay = page.locator("#drop-overlay");
    expect(await overlay.isVisible()).toBe(false);

    // Simulate dragenter using page.evaluate to construct a real DataTransfer
    await page.evaluate(() => {
      const dt = new DataTransfer();
      document.dispatchEvent(
        new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }),
      );
    });
    await overlay.waitFor({ state: "visible" });
    expect(await overlay.isVisible()).toBe(true);

    // Simulate dragleave
    await page.evaluate(() => {
      const dt = new DataTransfer();
      document.dispatchEvent(
        new DragEvent("dragleave", { dataTransfer: dt, bubbles: true }),
      );
    });
    expect(await overlay.isVisible()).toBe(false);
  });

  test("can open an mbtiles file via drag and drop", async () => {
    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });

    await dropFile(page, fs.readFileSync(fixturePath), "plain_1.mbtiles");

    // Wait for map to become visible
    const map = page.locator("#map");
    await map.waitFor({ state: "visible", timeout: 30_000 });

    // Verify MapLibre has rendered a canvas
    const canvas = map.locator("canvas");
    await canvas.waitFor({ state: "attached", timeout: 10_000 });
    expect(await canvas.count()).toBeGreaterThan(0);
  });

  test("can open and view an mbtiles file", async () => {
    await openMapFile(page);
    const canvas = page.locator("#map canvas");
    expect(await canvas.count()).toBeGreaterThan(0);
  });

  // Vector tiles are parsed in MapLibre's own worker, unlike raster tiles
  async function waitForRenderedFeatures(layerId: string) {
    await page.waitForFunction(
      (id) => {
        const map = (window as any).maplibreMap;
        return (
          map?.getLayer(id) &&
          map.queryRenderedFeatures({ layers: [id] }).length > 0
        );
      },
      layerId,
      { timeout: 30_000 },
    );
  }

  test("renders vector tiles", async () => {
    await openMapFile(page, vectorFixturePath);
    await waitForRenderedFeatures("shapes-polygons");
  });

  const testRoundTrip = opts?.skipDownloadTest ? test.skip : test;
  testRoundTrip("renders a vector mbtiles exported to smp", async () => {
    await openMapFile(page, vectorFixturePath);
    const downloadBtn = page.locator("#download-smp");
    await downloadBtn.waitFor({ state: "visible", timeout: 10_000 });
    await page.evaluate(() => navigator.serviceWorker.ready);

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      downloadBtn.click(),
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) {
      chunks.push(Buffer.from(chunk));
    }

    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });
    await dropFile(page, Buffer.concat(chunks), "vector_1.smp");
    await waitForRenderedFeatures("shapes-polygons");
  });

  test("can pan the map by dragging", async () => {
    await openMapFile(page);

    const canvas = page.locator("#map canvas").first();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();

    // Get the initial map center
    const centerBefore = await page.evaluate(
      () => (window as any).maplibreMap?.getCenter(),
    );

    // Drag from center to the left
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY, { steps: 5 });
    await page.mouse.up();

    // Wait briefly for the map to update
    await page.waitForTimeout(500);

    const centerAfter = await page.evaluate(
      () => (window as any).maplibreMap?.getCenter(),
    );

    // The longitude should have changed after dragging horizontally
    expect(centerAfter.lng).not.toBeCloseTo(centerBefore.lng, 1);
  });

  test("can open an smp file via the file picker", async () => {
    await openMapFile(page, smpFixturePath);
    await waitForLayer(page, "raster");
    await waitForLayer(page, "smp-bounds");
    // Exporting only applies to MBTiles
    expect(await page.locator("#download-smp").count()).toBe(0);
  });

  test("can open an smp file via drag and drop", async () => {
    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });
    await dropFile(page, fs.readFileSync(smpFixturePath), "plain_1.smp");
    await page.locator("#map").waitFor({ state: "visible", timeout: 30_000 });
    await waitForLayer(page, "smp-bounds");
  });

  test("opens an mbtiles file after a sqlite file that is not mbtiles", async () => {
    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });
    await dropFile(page, fs.readFileSync(notMbtilesPath), "notes.sqlite");
    await page.locator("#open-error").waitFor({ state: "visible", timeout: 10_000 });

    await dropFile(page, fs.readFileSync(fixturePath), "plain_1.mbtiles");
    await page.locator("#map").waitFor({ state: "visible", timeout: 30_000 });
    expect(await page.locator("#open-error").isVisible()).toBe(false);
  });

  test("shows an error for unsupported files", async () => {
    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });
    await dropFile(page, new TextEncoder().encode("not a map"), "notes.txt");

    const error = page.locator("#open-error");
    await error.waitFor({ state: "visible", timeout: 10_000 });
    expect(await error.textContent()).toContain("notes.txt");
    await page.locator("#open-button").waitFor({ state: "visible" });
    expect(await page.locator("#map").isVisible()).toBe(false);
  });

  const testDownload = opts?.skipDownloadTest ? test.skip : test;
  testDownload("can download mbtiles as smp file", async () => {
    await openMapFile(page);

    const downloadBtn = page.locator("#download-smp");
    await downloadBtn.waitFor({ state: "visible", timeout: 10_000 });

    // Remove showSaveFilePicker so the code uses the service worker streaming
    // path (which triggers a download via Content-Disposition that Playwright
    // can capture).
    await page.evaluate(async () => {
      delete (window as any).showSaveFilePicker;
      // Ensure service worker is active before triggering download
      await navigator.serviceWorker.ready;
    });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      downloadBtn.click(),
    ]);

    expect(download.suggestedFilename()).toBe("plain_1.smp");

    const readable = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(Buffer.from(chunk));
    }
    const fileContents = Buffer.concat(chunks);

    // SMP files are zip archives — verify the zip magic number (PK\x03\x04)
    expect(fileContents[0]).toBe(0x50); // P
    expect(fileContents[1]).toBe(0x4b); // K
    expect(fileContents.length).toBeGreaterThan(100);
  });

  // Safari doesn't route the download navigation through the service worker
  testDownload("offers a save link when the download can't be streamed", async () => {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const uncontrolled = await context.newPage();
    try {
      await openMapFile(uncontrolled);
      const downloadBtn = uncontrolled.locator("#download-smp");
      await downloadBtn.waitFor({ state: "visible", timeout: 10_000 });
      await downloadBtn.click();

      const saveLink = uncontrolled.locator("#save-smp");
      await saveLink.waitFor({ state: "visible", timeout: 60_000 });
      expect(await saveLink.textContent()).toContain("plain_1.smp");

      const [download] = await Promise.all([
        uncontrolled.waitForEvent("download", { timeout: 30_000 }),
        saveLink.click(),
      ]);
      expect(download.suggestedFilename()).toBe("plain_1.smp");

      const chunks: Buffer[] = [];
      for await (const chunk of await download.createReadStream()) {
        chunks.push(Buffer.from(chunk));
      }
      const fileContents = Buffer.concat(chunks);
      expect(fileContents.subarray(0, 2).toString()).toBe("PK");
      expect(fileContents.length).toBeGreaterThan(100);
    } finally {
      await context.close();
    }
  });
}

describe("chromium", () => {
  appTests(chromium, {
    args: ["--ignore-gpu-blocklist", "--enable-webgl", ...chromiumArgs],
  });
});

const describeFirefox = process.env.CI ? describe.skip : describe;
describeFirefox("firefox", () => {
  appTests(firefox, undefined, { skipDownloadTest: true });
});

// Playwright's WebKit uses ephemeral (non-persistent) browser contexts which
// do not support OPFS. This app requires OPFS, so WebKit e2e tests are skipped.
// OPFS works in real Safari — this is a Playwright limitation, not a Safari bug.
// See: https://github.com/microsoft/playwright/issues/18235
describe.skip("webkit", () => {
  appTests(webkit);
});

// SMP files are read straight from the File, so unlike MBTiles they need no OPFS
// and do work in WebKit. Safari evaluates the worker's module graph twice for a
// dynamic import, which left half the tile requests answered by a second copy of
// the worker with no file open — an empty map with no error.
describe("webkit (smp only)", () => {
  let browser: Browser;
  let page: Page;
  let warnings: string[] = [];

  beforeAll(async () => {
    browser = await webkit.launch({ headless: true });
    page = await browser.newPage();
    page.on("console", (message) => {
      if (message.text().includes("Could not load")) warnings.push(message.text());
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("loads every resource of an smp file", async () => {
    warnings = [];
    await openMapFile(page, smpFixturePath);
    await waitForLayer(page, "raster");
    await page.waitForFunction(
      () => (window as any).maplibreMap?.areTilesLoaded(),
      null,
      { timeout: 30_000 },
    );
    expect(warnings).toEqual([]);
  });
});
