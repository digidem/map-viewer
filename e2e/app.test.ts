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
const baseUrl = "http://localhost:4174";

const chromiumArgs =
  process.platform === "darwin"
    ? ["--use-gl=angle", "--use-angle=metal"]
    : ["--use-gl=angle", "--use-angle=swiftshader"];

/** Open an mbtiles file and wait for the map to render */
async function openMbtilesFile(page: Page, filePath = fixturePath) {
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

    // Read the fixture file and create a DataTransfer-like drop event
    const buffer = await import("fs").then((fs) =>
      fs.readFileSync(fixturePath),
    );

    // Use Playwright's page.evaluate to simulate a drop with a real File
    await page.evaluate(
      async ({ bytes, fileName }) => {
        const uint8 = new Uint8Array(bytes);
        const file = new File([uint8], fileName);
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Dispatch dragenter first so the overlay shows
        document.dispatchEvent(
          new DragEvent("dragenter", { dataTransfer, bubbles: true }),
        );
        // Then dispatch drop
        document.dispatchEvent(
          new DragEvent("drop", { dataTransfer, bubbles: true }),
        );
      },
      { bytes: Array.from(buffer), fileName: "plain_1.mbtiles" },
    );

    // Wait for map to become visible
    const map = page.locator("#map");
    await map.waitFor({ state: "visible", timeout: 30_000 });

    // Verify MapLibre has rendered a canvas
    const canvas = map.locator("canvas");
    await canvas.waitFor({ state: "attached", timeout: 10_000 });
    expect(await canvas.count()).toBeGreaterThan(0);
  });

  test("can open and view an mbtiles file", async () => {
    await openMbtilesFile(page);
    const canvas = page.locator("#map canvas");
    expect(await canvas.count()).toBeGreaterThan(0);
  });

  test("renders vector tiles", async () => {
    await openMbtilesFile(page, vectorFixturePath);
    // Vector tiles are parsed in MapLibre's own worker, unlike raster tiles
    await page.waitForFunction(
      () => {
        const map = (window as any).maplibreMap;
        return (
          map?.getLayer("shapes-polygons") &&
          map.queryRenderedFeatures({ layers: ["shapes-polygons"] }).length > 0
        );
      },
      null,
      { timeout: 30_000 },
    );
  });

  test("can pan the map by dragging", async () => {
    await openMbtilesFile(page);

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

  const testDownload = opts?.skipDownloadTest ? test.skip : test;
  testDownload("can download mbtiles as smp file", async () => {
    await openMbtilesFile(page);

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
