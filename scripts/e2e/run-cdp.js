// connectOverCDP 版: 既に起動済みの Obsidian（--remote-debugging-port=9222）に接続して検証する。
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const VAULT = process.env.VAULT;
const OUT = process.env.OUT || ".";
const logs = [];
const rec = (tag, ...a) => {
  const line = `[${tag}] ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  logs.push(line);
  console.log(line);
};
const dump = () =>
  fs.writeFileSync(path.join(OUT, "console.log"), logs.join("\n") + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readFm = (f) => {
  try {
    return fs.readFileSync(path.join(VAULT, f), "utf8").split("\n---")[0].replace(/\n/g, " | ");
  } catch (e) {
    return `READ_ERR:${e}`;
  }
};

(async () => {
  const browser = await chromium.connectOverCDP(CDP, { timeout: 30000 });
  rec("harness", "connected over CDP");
  const ctx = browser.contexts()[0];
  let page = null;
  for (let attempt = 0; attempt < 20 && !page; attempt++) {
    for (const p of ctx.pages()) {
      let ok = false;
      try {
        ok = await p.evaluate(() => !!(window.app && window.app.workspace));
      } catch (_) {}
      if (ok) {
        page = p;
        break;
      }
    }
    if (!page) await sleep(1000);
  }
  if (!page) {
    rec("FATAL", "no page with window.app.workspace");
    dump();
    process.exit(3);
  }
  rec("harness", "vault page found:", await page.title());
  page.on("console", (m) => rec("console", m.type(), m.text()));
  page.on("pageerror", (e) => rec("pageerror", String(e)));

  await page
    .waitForFunction(() => window.app?.workspace?.layoutReady, { timeout: 30000 })
    .then(() => rec("harness", "layoutReady"))
    .catch((e) => rec("warn", "layoutReady timeout:", String(e)));

  // プラグイン状況
  try {
    const plug = await page.evaluate(() => ({
      enabled: [...(window.app.plugins?.enabledPlugins || [])],
      loaded: Object.keys(window.app.plugins?.plugins || {}),
      basesLoaded:
        !!window.app.internalPlugins?.getPluginById?.("bases")?._loaded,
    }));
    rec("plugins", JSON.stringify(plug));
  } catch (e) {
    rec("warn", "plugin introspect:", String(e));
  }

  // .base を開く
  try {
    const opened = await page.evaluate(async () => {
      const f = window.app.vault.getAbstractFileByPath("Eisenhower.base");
      if (!f) return { ok: false, reason: "no Eisenhower.base" };
      const leaf = window.app.workspace.getLeaf(true);
      await leaf.openFile(f);
      await new Promise((r) => setTimeout(r, 800));
      return { ok: true, viewType: leaf.view?.getViewType?.() };
    });
    rec("openBase", JSON.stringify(opened));
  } catch (e) {
    rec("warn", "openBase:", String(e));
  }

  let rendered = false;
  try {
    await page.waitForSelector(".eisenhower-spike", { timeout: 20000 });
    rendered = true;
    rec("harness", "spike view rendered");
  } catch (e) {
    rec("warn", "spike not rendered:", String(e));
    // 何が描画されているか少しだけ覗く
    try {
      const probe = await page.evaluate(() => ({
        leafTypes: window.app.workspace
          .getLeavesOfType?.("bases")
          ?.map((l) => l.view?.getViewType?.()),
        bodyHas: document.body.innerText.slice(0, 200),
      }));
      rec("probe", JSON.stringify(probe));
    } catch (_) {}
  }

  if (rendered) {
    try {
      const cells = await page.evaluate(() =>
        [...document.querySelectorAll(".eisenhower-spike__cell")].map((c) => ({
          head: c.querySelector("h4")?.textContent,
          cards: [...c.querySelectorAll(".eisenhower-spike__card span")].map(
            (s) => s.textContent,
          ),
        })),
      );
      rec("dom-cells", JSON.stringify(cells));
    } catch (e) {
      rec("warn", "cells:", String(e));
    }
  }

  // 検証3: schedule.md を →do へ
  const before = logs.filter((l) => l.includes("onDataUpdated")).length;
  rec("writeback", "before schedule.md fm:", readFm("schedule.md"));
  if (rendered) {
    try {
      const clicked = await page.evaluate(() => {
        const card = [
          ...document.querySelectorAll(".eisenhower-spike__card"),
        ].find((c) =>
          (c.querySelector("span")?.textContent || "")
            .toLowerCase()
            .includes("schedule"),
        );
        const btn =
          card &&
          [...card.querySelectorAll("button")].find((b) =>
            b.textContent.includes("→do"),
          );
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });
      rec("writeback", "clicked →do:", clicked);
    } catch (e) {
      rec("warn", "click:", String(e));
    }
  }
  await sleep(2500);
  rec("writeback", "after schedule.md fm:", readFm("schedule.md"));
  const after = logs.filter((l) => l.includes("onDataUpdated")).length;
  rec("verify", "onDataUpdated before/after:", {
    before,
    after,
    autoRefired: after > before,
  });

  try {
    await page.screenshot({ path: path.join(OUT, "spike.png") });
    rec("harness", "screenshot saved");
  } catch (e) {
    rec("warn", "screenshot:", String(e));
  }

  dump();
  await browser.close(); // CDP: disconnects, does NOT kill obsidian
  rec("harness", "done (obsidian left running; kill via pid)");
  dump();
  process.exit(0);
})().catch((e) => {
  rec("FATAL", String(e));
  dump();
  process.exit(1);
});
