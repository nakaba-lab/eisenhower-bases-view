// #43 恒久対策の回帰ハーネス: DragOverlay の portal 先（body）系に「包含ブロックの原点ずれ」が
// あると掴みオフセットが出る/出ないを実ブラウザ・実ドラッグで測る。
//
// 使い方（preview harness と同系統。詳細は scripts/preview/README.md）:
//   1) npm run preview:build
//   2) リポジトリルートで  python3 -m http.server 8765
//   3) node scripts/preview/measure-shifted.mjs
//
// 期待値（本 fix 適用後）: baseline / body transform / html transform いずれも OFFSET 0。
//   修正前は body:translate(70,45)→(70,45)・html:translate(0,55)→(0,55) とずれる（＝#43 再燃の実証）。
//
// ブラウザは playwright 既定解決（PLAYWRIGHT_BROWSERS_PATH 等）を使う。別バイナリは CHROME_BIN で上書き可。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("../e2e/node_modules/playwright");

const BASE = process.env.PREVIEW_BASE || "http://127.0.0.1:8765/scripts/preview";
const URL = `${BASE}/preview-contain.html`;
const launchOpts = { headless: true };
if (process.env.CHROME_BIN) launchOpts.executablePath = process.env.CHROME_BIN;

async function measure({ label, inject }) {
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  // Obsidian のグローバル（メイン window では activeDocument === document）を供給する。
  await page.addInitScript(() => {
    window.activeDocument = document;
    window.activeWindow = window;
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(".eisenhower-note-card", { timeout: 10000 });
  if (inject) {
    await page.evaluate(inject);
    await page.waitForTimeout(60);
  }
  const card = page.locator(".eisenhower-note-card").first();
  const box = await card.boundingBox();
  const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cardRectBefore = await card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const delta = { x: 120, y: 90 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 8, grab.y + 8, { steps: 3 }); // >5px で活性化
  await page.mouse.move(grab.x + delta.x, grab.y + delta.y, { steps: 10 });
  const m = await page.evaluate(() => {
    const overlay = document.querySelector(".eisenhower-note-card--overlay");
    if (!overlay) return { overlayFound: false };
    let w = overlay;
    while (w && getComputedStyle(w).position !== "fixed") w = w.parentElement;
    const r = (w || overlay).getBoundingClientRect();
    const b = document.body.getBoundingClientRect();
    return {
      overlayFound: true,
      top: r.top,
      left: r.left,
      bodyTransform: getComputedStyle(document.body).transform,
      bodyTop: b.top,
      bodyLeft: b.left,
    };
  });
  await page.mouse.up().catch(() => {});
  await browser.close();
  if (!m.overlayFound) return { label, error: "overlay not activated" };
  return {
    label,
    bodyTransform: m.bodyTransform,
    bodyOrigin: { left: +m.bodyLeft.toFixed(1), top: +m.bodyTop.toFixed(1) },
    OFFSET_px: {
      x: +(m.left - (cardRectBefore.left + delta.x)).toFixed(2),
      y: +(m.top - (cardRectBefore.top + delta.y)).toFixed(2),
    },
  };
}

const out = [];
out.push(await measure({ label: "baseline (body clean, origin 0,0)" }));
out.push(
  await measure({
    label: "body transform translate(70,45)",
    inject: () => {
      document.body.style.transform = "translate(70px,45px)";
    },
  }),
);
out.push(
  await measure({
    label: "html transform translate(0,55)",
    inject: () => {
      document.documentElement.style.transform = "translate(0px,55px)";
    },
  }),
);
console.log(JSON.stringify(out, null, 2));
const bad = out.filter((r) => r.OFFSET_px && (r.OFFSET_px.x !== 0 || r.OFFSET_px.y !== 0));
console.log(bad.length === 0 ? "\nPASS: all OFFSET 0 (compensation holds)" : `\nFAIL: ${bad.length} non-zero offset`);
process.exit(bad.length === 0 ? 0 : 1);
