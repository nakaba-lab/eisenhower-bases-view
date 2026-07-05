// connectOverCDP 版: 起動済み Obsidian（--remote-debugging-port）に接続し、本実装（F1〜F6）の
// Bases カスタムビュー往復を検証する。README「本実装への移行メモ」に従いスパイク版から更新した:
//  (1) セレクタを本実装（.eisenhower-matrix / .eisenhower-quadrant / .eisenhower-note-card）へ
//  (2) 移動操作をボタン click → dnd-kit の**実ポインタドラッグ**（PopoutPointerSensor 経由）へ
//  (3) onDataUpdated 自動再発火を plugin.liveViews のインスタンス計測で確認（プラグインは console 出力しない）
//  (4) 書き戻し後の**サーバ由来 re-classification**を、base を開き直して楽観オーバーレイ無しの新規描画で検証
//      （楽観移動だけで満たされる偽陽性を避ける・PR#48 レビュー指摘）
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const VAULT = process.env.VAULT;
const OUT = process.env.OUT || ".";
const logs = [];
const result = { checks: [], dom: null, writeBack: null, reclassify: null, undo: null };
let page = null;
let browser = null;

const rec = (tag, ...a) => {
  const line = `[${tag}] ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  logs.push(line);
  console.log(line);
};
const check = (name, pass, detail) => {
  result.checks.push({ name, pass: !!pass, detail: detail ?? null });
  rec(pass ? "PASS" : "FAIL", name, detail ? JSON.stringify(detail) : "");
};
const dump = () => {
  fs.writeFileSync(path.join(OUT, "console.log"), logs.join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2) + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 条件が真になるまで短間隔ポーリング（固定 sleep の非決定的失敗を避ける）。timeout で最後の値を返す。
const until = async (fn, { timeout = 8000, interval = 200, label = "" } = {}) => {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch (_) { v = undefined; }
    if (v) return v;
    if (Date.now() - t0 > timeout) { rec("warn", `until timeout: ${label}`); return v; }
    await sleep(interval);
  }
};
// frontmatter（"---" 間）を読み取り「key: value」を平坦化して返す（書き戻し検証用）。
const readFm = (f) => {
  try {
    const raw = fs.readFileSync(path.join(VAULT, f), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    return m ? m[1].replace(/\n/g, " | ") : "(no frontmatter)";
  } catch (e) {
    return `READ_ERR:${e}`;
  }
};
const snap = async (name) => {
  try { await page.screenshot({ path: path.join(OUT, name) }); rec("shot", name); }
  catch (e) { rec("warn", "screenshot " + name, String(e)); }
};
// Do 象限のカード名一覧を DOM から読む。
const readDoCards = () =>
  page.evaluate(() => {
    const doCell = [...document.querySelectorAll(".eisenhower-quadrant")]
      .find((c) => c.querySelector(".eisenhower-quadrant__title")?.textContent === "Do");
    return [...(doCell?.querySelectorAll(".eisenhower-note-card") || [])]
      .map((n) => n.textContent.replace("🔒", "").trim());
  });
// base を開き直して（楽観保留の無い）新規描画にし、Do 象限のカードを読む。
const reopenBaseAndReadDo = async () => {
  await page.evaluate(() => {
    for (const l of window.app.workspace.getLeavesOfType?.("bases") || []) l.detach();
  });
  await sleep(300);
  await page.evaluate(async () => {
    const f = window.app.vault.getAbstractFileByPath("Eisenhower.base");
    const leaf = window.app.workspace.getLeaf(true);
    await leaf.openFile(f);
  });
  await page.waitForSelector(".eisenhower-matrix__grid", { timeout: 15000 }).catch(() => {});
  await sleep(400);
  return readDoCards();
};

(async () => {
  browser = await chromium.connectOverCDP(CDP, { timeout: 30000 });
  rec("harness", "connected over CDP");
  const ctx = browser.contexts()[0];

  // window.app.workspace を持つレンダラページ（Obsidian 本体）を探す。
  for (let attempt = 0; attempt < 20 && !page; attempt++) {
    for (const p of ctx.pages()) {
      let ok = false;
      try { ok = await p.evaluate(() => !!(window.app && window.app.workspace)); } catch (_) {}
      if (ok) { page = p; break; }
    }
    if (!page) await sleep(1000);
  }
  if (!page) { check("app page found", false, "no window.app.workspace"); dump(); process.exit(3); }
  rec("harness", "vault page:", await page.title());
  page.on("console", (m) => rec("console", m.type(), m.text()));
  page.on("pageerror", (e) => rec("pageerror", String(e)));

  await page
    .waitForFunction(() => window.app?.workspace?.layoutReady, { timeout: 30000 })
    .then(() => rec("harness", "layoutReady"))
    .catch((e) => rec("warn", "layoutReady timeout:", String(e)));

  // 1) プラグイン & Bases の状況
  const plug = await page.evaluate(() => ({
    enabled: [...(window.app.plugins?.enabledPlugins || [])],
    loaded: Object.keys(window.app.plugins?.plugins || {}),
    basesLoaded: !!window.app.internalPlugins?.getPluginById?.("bases")?._loaded,
  }));
  rec("plugins", JSON.stringify(plug));
  check("plugin enabled (eisenhower-bases-view)", plug.enabled.includes("eisenhower-bases-view"), plug.enabled);
  check("bases core plugin loaded", plug.basesLoaded);

  // 1.5) 初回オープンの信頼ダイアログ（restricted mode）でコミュニティプラグインが未ロードのため、
  //      restricted mode を解除してプラグインをロードする（onload→registerBasesView を走らせる）。
  const enableRes = await page.evaluate(async () => {
    const p = window.app.plugins;
    const steps = {};
    try { if (p.setEnable) { await p.setEnable(true); steps.setEnable = true; } } catch (e) { steps.setEnableErr = String(e); }
    try { steps.enablePlugin = await p.enablePlugin("eisenhower-bases-view").then(() => true).catch((e) => String(e)); } catch (e) { steps.enableErr = String(e); }
    const btn = [...document.querySelectorAll(".modal button, .modal .mod-cta")]
      .find((b) => /trust|信頼|enable/i.test(b.textContent || ""));
    if (btn) { btn.click(); steps.trustClicked = btn.textContent; }
    return steps;
  });
  rec("enable", JSON.stringify(enableRes));
  await page.waitForFunction(
    () => !!window.app.plugins.plugins["eisenhower-bases-view"],
    { timeout: 15000 },
  ).then(() => rec("enable", "plugin loaded")).catch((e) => rec("warn", "plugin load timeout:", String(e)));
  const loaded2 = await page.evaluate(() => Object.keys(window.app.plugins.plugins || {}));
  check("plugin loaded（onload/registerBasesView 実行）", loaded2.includes("eisenhower-bases-view"), loaded2);

  // 2) .base を開く（プラグイン登録後。既存 base leaf があれば detach してから開き直す）
  await page.evaluate(() => {
    for (const l of window.app.workspace.getLeavesOfType?.("bases") || []) l.detach();
  }).catch(() => {});
  await sleep(400);
  const opened = await page.evaluate(async () => {
    const f = window.app.vault.getAbstractFileByPath("Eisenhower.base");
    if (!f) return { ok: false, reason: "no Eisenhower.base" };
    const leaf = window.app.workspace.getLeaf(true);
    await leaf.openFile(f);
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: true, viewType: leaf.view?.getViewType?.() };
  });
  rec("openBase", JSON.stringify(opened));

  // 3) 本実装ビューが描画されるまで待つ
  let rendered = false;
  try {
    await page.waitForSelector(".eisenhower-matrix", { timeout: 25000 });
    await page.waitForSelector(".eisenhower-matrix__grid", { timeout: 15000 });
    rendered = true;
  } catch (e) {
    rec("warn", "matrix not rendered:", String(e));
    const probe = await page.evaluate(() => ({
      basesLeaves: window.app.workspace.getLeavesOfType?.("bases")?.map((l) => l.view?.getViewType?.()),
      body: document.body.innerText.slice(0, 300),
    })).catch(() => ({}));
    rec("probe", JSON.stringify(probe));
  }
  check("matrix view rendered (registerBasesView 往復)", rendered);
  if (!rendered) { await snap("matrix.png"); dump(); await browser.close(); process.exit(2); }

  // 4) 配置スナップショット（象限別カード + locked + 件数）
  const dom = await page.evaluate(() => {
    return [...document.querySelectorAll(".eisenhower-quadrant")].map((c) => ({
      title: c.querySelector(".eisenhower-quadrant__title")?.textContent ?? null,
      count: c.querySelector(".eisenhower-quadrant__count")?.textContent ?? null,
      unclassified: c.classList.contains("eisenhower-quadrant--unclassified"),
      cards: [...c.querySelectorAll(".eisenhower-note-card")].map((n) => ({
        title: n.textContent.replace("🔒", "").trim(),
        locked: n.classList.contains("eisenhower-note-card--locked"),
        draggable: n.getAttribute("aria-roledescription") === "draggable",
      })),
    }));
  });
  result.dom = dom;
  rec("dom", JSON.stringify(dom));
  const byTitle = (t) => dom.find((c) => c.title === t) || { cards: [] };
  const titles = (t) => byTitle(t).cards.map((x) => x.title).sort();
  const unc = dom.find((c) => c.unclassified) || { cards: [] };
  const uncTitles = unc.cards.map((x) => x.title).sort();
  check("Do 象限 = [do, infolder]（フォルダ配下ノートも正配置）", JSON.stringify(titles("Do")) === JSON.stringify(["do", "infolder"]), titles("Do"));
  check("Schedule 象限 = [schedule]", JSON.stringify(titles("Schedule")) === JSON.stringify(["schedule"]), titles("Schedule"));
  check("Delegate 象限 = [delegate]", JSON.stringify(titles("Delegate")) === JSON.stringify(["delegate"]), titles("Delegate"));
  check("Delete 象限 = [delete]", JSON.stringify(titles("Delete")) === JSON.stringify(["delete"]), titles("Delete"));
  check("未分類に absent/partial/numeric（軸欠損・非 boolean）", ["absent", "numeric", "partial"].every((t) => uncTitles.includes(t)), uncTitles);
  const numeric = unc.cards.find((x) => x.title === "numeric");
  check("非 boolean 軸カード numeric は locked（ドラッグ不可）", numeric && numeric.locked && !numeric.draggable, numeric);
  const absent = unc.cards.find((x) => x.title === "absent");
  check("軸欠損カード absent は draggable（locked でない）", absent && !absent.locked && absent.draggable, absent);
  // .base 自己エントリ（Eisenhower）がカード化されていないこと（非 md 除外の証跡＝dom 由来）
  const allTitles = dom.flatMap((c) => c.cards.map((x) => x.title));
  check("`.base` 自己エントリ（Eisenhower）がカード化されない（非 md 除外）", !allTitles.includes("Eisenhower"), allTitles);
  await snap("01-initial.png");

  // 5) onDataUpdated 自動再発火の計測をインストルメント（plugin.liveViews の各ビュー）
  const wrapped = await page.evaluate(() => {
    window.__eisenDU = 0;
    const p = window.app.plugins.plugins["eisenhower-bases-view"];
    const views = p && p.liveViews ? [...p.liveViews] : [];
    for (const v of views) {
      if (v.__wrapped) continue;
      const orig = v.onDataUpdated.bind(v);
      v.onDataUpdated = function () { window.__eisenDU++; return orig(); };
      v.__wrapped = true;
    }
    return views.length;
  });
  // liveViews が空だと onDataUpdated 計測が無効化され「未計測なのに PASS」になるため、計測対象があることを確かめる。
  check("onDataUpdated 計測対象ビューが存在（liveViews 非空＝計測有効）", wrapped > 0, { wrappedViews: wrapped });

  // 6) 書き戻し（実ポインタドラッグ）: schedule カード → Do 象限
  result.writeBack = { before: readFm("schedule.md") };
  rec("writeback", "schedule.md before:", result.writeBack.before);
  const srcBox = await page.locator('.eisenhower-note-card', { hasText: /^schedule$/ }).first().boundingBox();
  const doCell = page.locator('.eisenhower-quadrant:has(.eisenhower-quadrant__title:text-is("Do"))').first();
  const dstBox = await doCell.boundingBox();
  if (srcBox && dstBox) {
    const sx = srcBox.x + srcBox.width / 2, sy = srcBox.y + srcBox.height / 2;
    const dx = dstBox.x + dstBox.width / 2, dy = dstBox.y + dstBox.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    // >5px（PointerSensor activationConstraint distance:5）を超える移動でドラッグ活性化 → 目標へ多段移動
    await page.mouse.move(sx + 8, sy + 8, { steps: 4 });
    await page.mouse.move(dx, dy, { steps: 15 });
    await page.mouse.move(dx, dy, { steps: 2 });
    await page.mouse.up();
    rec("writeback", "dragged schedule -> Do", { sx, sy, dx, dy });
  } else {
    rec("warn", "boundingBox null", { srcBox, dstBox });
  }
  // 固定 sleep をやめ、ファイルが urgent:true になるまで + onDataUpdated 発火までポーリング（#8）
  await until(() => /urgent:\s*true/.test(readFm("schedule.md")), { timeout: 8000, label: "schedule urgent:true" });
  result.writeBack.after = readFm("schedule.md");
  result.writeBack.onDataUpdatedCount =
    (await until(async () => { const n = await page.evaluate(() => window.__eisenDU); return n > 0 ? n : 0; }, { timeout: 8000, label: "onDataUpdated>0" })) || 0;
  rec("writeback", "schedule.md after:", result.writeBack.after, "onDataUpdated:", result.writeBack.onDataUpdatedCount);
  const wroteDo = /urgent:\s*true/.test(result.writeBack.after) && /important:\s*true/.test(result.writeBack.after);
  check("ドラッグ書き戻し: schedule.md が urgent:true/important:true（processFrontMatter）", wroteDo, result.writeBack.after);
  check("onDataUpdated が書き戻し後に自動再発火（手動再描画なし）", result.writeBack.onDataUpdatedCount > 0, result.writeBack.onDataUpdatedCount);
  await snap("02-after-writeback.png");

  // 6.5) サーバ由来 re-classification（往復後半）: base を開き直して**楽観保留の無い**新規描画にし、
  //      schedule が Do に居ることを確認する。これで「楽観オーバーレイだけで PASS」する偽陽性を排除し、
  //      getValue が新しい frontmatter を読み classifyQuadrant で Do に置いた往復後半を独立に証明する（PR#48 指摘）。
  const reclass = await reopenBaseAndReadDo();
  result.reclassify = reclass;
  rec("reclassify", "Do cards after reopen (no pending):", JSON.stringify(reclass));
  check("書き戻し後のサーバ再分類: 再オープン（楽観保留なし）で schedule が Do 象限に配置される（getValue→再分類）", reclass.includes("schedule"), reclass);

  // 7) undo（コマンド）: 前提（移動後=urgent:true）とコマンド成否をアサートしてから true→false 遷移を検証（#2/#9）
  result.undo = { before: readFm("schedule.md") };
  check("undo 前提: 書き戻しで schedule.md が urgent:true（移動後状態）", /urgent:\s*true/.test(result.undo.before), result.undo.before);
  const undoRes = await page.evaluate(() => {
    const id = "eisenhower-bases-view:undo-last-move";
    const cmd = window.app.commands.commands[id];
    if (!cmd) return { ok: false, reason: "command not found", ids: Object.keys(window.app.commands.commands).filter((k) => k.includes("eisenhower")) };
    window.app.commands.executeCommandById(id);
    return { ok: true };
  });
  rec("undo", JSON.stringify(undoRes));
  check("undo コマンドが存在し実行された", undoRes.ok === true, undoRes);
  await until(() => /urgent:\s*false/.test(readFm("schedule.md")), { timeout: 8000, label: "undo revert" });
  result.undo.after = readFm("schedule.md");
  rec("undo", "schedule.md after undo:", result.undo.after);
  const revertedOk =
    /urgent:\s*true/.test(result.undo.before) && // 移動後（前提）
    /urgent:\s*false/.test(result.undo.after) && /important:\s*true/.test(result.undo.after); // 元へ遷移
  check("undo コマンドで schedule.md が urgent:true→false へ遷移復元", revertedOk, { before: result.undo.before, after: result.undo.after });
  await snap("03-after-undo.png");

  const passed = result.checks.filter((c) => c.pass).length;
  rec("summary", `${passed}/${result.checks.length} checks passed`);
  dump();
  await browser.close(); // CDP: 切断のみ（obsidian は生存＝シェルの trap が kill）
  process.exit(result.checks.every((c) => c.pass) ? 0 : 1);
})().catch(async (e) => {
  rec("FATAL", String(e));
  // 中途失敗の視覚的証拠を残す（最も知りたい状態のスクショ）＋切断（#7）。
  try { if (page) await page.screenshot({ path: path.join(OUT, "99-fatal.png") }); rec("shot", "99-fatal.png"); } catch (_) {}
  try { if (browser) await browser.close(); } catch (_) {}
  dump();
  process.exit(1);
});
