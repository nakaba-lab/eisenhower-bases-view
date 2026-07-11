// S0 スパイク（v0.3 軸の一般化）: 実機 Obsidian で数値/文字列/タグ（リスト）の Value 表現を introspect する
// throwaway プローブ。#16/#33/#44 の CDP 検証ハーネス（run-cdp.js）と同じ connectOverCDP 方式。
//
// 目的（設計書 §4 の検証項目）:
//  1. entry.getValue("note.<key>") が数値/文字列/リストで返す Value の instanceof 判別（許可リスト §3.2）
//  2. 各 Value からの primitive 取り出し方（.data/.value/イテレート）
//  3. require('obsidian') が NumberValue/StringValue/リスト系 Value を export するか（名前と instanceof）
//  4. Bases options の型サーフェス（§3.6④・best-effort。不確定なら手動 Configure view 確認へ）
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CDP = process.env.CDP || "http://127.0.0.1:9222";
const VAULT = process.env.VAULT;
const OUT = process.env.OUT || ".";
const logs = [];
const result = { valueProbes: {}, obsidianExports: null, basesOptions: null, entriesSeen: null };

const rec = (tag, ...a) => {
  const line = `[${tag}] ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  logs.push(line);
  console.log(line);
};
const dump = () => {
  fs.writeFileSync(path.join(OUT, "probe-s0-console.log"), logs.join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "probe-s0-result.json"), JSON.stringify(result, null, 2) + "\n");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, { timeout = 15000, interval = 250, label = "" } = {}) => {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch (_) { v = undefined; }
    if (v) return v;
    if (Date.now() - t0 > timeout) { rec("warn", `until timeout: ${label}`); return v; }
    await sleep(interval);
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
      try { ok = await p.evaluate(() => !!(window.app && window.app.workspace)); } catch (_) {}
      if (ok) { page = p; break; }
    }
    if (!page) await sleep(1000);
  }
  if (!page) { rec("FATAL", "no window.app.workspace page"); dump(); process.exit(3); }
  rec("harness", "vault page:", await page.title());

  // 誤接続ガード（run-cdp.js と同型・別/実 Vault を触らない）
  if (!VAULT) { rec("FATAL", "VAULT env unset (誤接続ガードの前提)"); dump(); await browser.close(); process.exit(4); }
  const vaultPath = await page.evaluate(() => window.app?.vault?.adapter?.basePath ?? null);
  const canon = (p) => { try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); } };
  const okVault = vaultPath != null && canon(vaultPath) === canon(VAULT);
  if (!okVault) { rec("FATAL", "unexpected vault", { connected: vaultPath, expected: canon(VAULT) }); dump(); await browser.close(); process.exit(4); }
  rec("harness", "vault OK:", vaultPath);

  page.on("console", (m) => rec("console", m.type(), m.text()));
  page.on("pageerror", (e) => rec("pageerror", String(e)));

  await page.waitForFunction(() => window.app?.workspace?.layoutReady, { timeout: 30000 })
    .then(() => rec("harness", "layoutReady")).catch((e) => rec("warn", "layoutReady timeout", String(e)));

  // プラグイン有効化（restricted mode 解除→onload→registerBasesView）
  await page.evaluate(async () => {
    const p = window.app.plugins;
    try { if (p.setEnable) await p.setEnable(true); } catch (_) {}
    try { await p.enablePlugin("eisenhower-bases-view"); } catch (_) {}
    const btn = [...document.querySelectorAll(".modal button, .modal .mod-cta")]
      .find((b) => /trust|信頼|enable/i.test(b.textContent || ""));
    if (btn) btn.click();
  });
  await page.waitForFunction(() => !!window.app.plugins.plugins["eisenhower-bases-view"], { timeout: 15000 })
    .then(() => rec("enable", "plugin loaded")).catch((e) => rec("warn", "plugin load timeout", String(e)));

  // .base を開いて liveView に entries を載せる
  await page.evaluate(async () => {
    for (const l of window.app.workspace.getLeavesOfType?.("bases") || []) l.detach();
    const f = window.app.vault.getAbstractFileByPath("Probe.base");
    const leaf = window.app.workspace.getLeaf(true);
    await leaf.openFile(f);
  });
  await sleep(1500);

  // liveView の entries（this.data.data）が載るまで待つ
  const entryReady = await until(async () =>
    page.evaluate(() => {
      const p = window.app.plugins.plugins["eisenhower-bases-view"];
      const views = p && p.liveViews ? [...p.liveViews] : [];
      for (const v of views) {
        const entries = v?.data?.data;
        if (Array.isArray(entries) && entries.length > 0) return true;
      }
      return false;
    }), { timeout: 20000, label: "entries loaded" });
  rec("harness", "entries ready:", !!entryReady);

  // ---- コア: 各フィクスチャの Value を introspect ----
  const probe = await page.evaluate(() => {
    const p = window.app.plugins.plugins["eisenhower-bases-view"];
    const views = p && p.liveViews ? [...p.liveViews] : [];
    let entries = [];
    for (const v of views) {
      const d = v?.data?.data;
      if (Array.isArray(d) && d.length) { entries = d; break; }
    }

    const safe = (fn) => { try { return fn(); } catch (e) { return `ERR:${String(e)}`; } };
    const truncate = (s, n = 200) => (typeof s === "string" && s.length > n ? s.slice(0, n) + "…" : s);

    // Value 1 個を introspect（instanceof は下の obsidian exports 側で確定するのでここは形状中心）
    const introspect = (v) => {
      if (v === null) return { js: "null" };
      if (v === undefined) return { js: "undefined" };
      const proto = Object.getPrototypeOf(v);
      const protoKeys = proto ? Object.getOwnPropertyNames(proto) : [];
      return {
        typeof: typeof v,
        ctorName: safe(() => v.constructor && v.constructor.name),
        protoCtorName: safe(() => proto && proto.constructor && proto.constructor.name),
        toStringVal: truncate(safe(() => String(v.toString()))),
        isTruthy: safe(() => (typeof v.isTruthy === "function" ? v.isTruthy() : "(none)")),
        ownKeys: safe(() => Object.getOwnPropertyNames(v)),
        protoKeys,
        dataProp: truncate(safe(() => JSON.stringify(v.data))),
        valueProp: truncate(safe(() => JSON.stringify(v.value))),
        lengthProp: safe(() => v.length),
        isIterable: safe(() => typeof v[Symbol.iterator] === "function"),
        iterated: truncate(safe(() => {
          if (typeof v[Symbol.iterator] !== "function") return "(not iterable)";
          return Array.from(v).map((x) => (x && x.toString ? String(x.toString()) : String(x)));
        })),
        json: truncate(safe(() => JSON.stringify(v))),
      };
    };

    // フィクスチャ名 → プロパティ の対応。getValue は note.<key>。
    const probes = [
      { note: "bool-note", key: "flag", label: "boolean control" },
      { note: "num-note", key: "score", label: "number" },
      { note: "num-note", key: "score", cast: "float", label: "number(float)" },
      { note: "str-note", key: "level", label: "string" },
      { note: "tag-note", key: "tags", label: "list/tags(array)" },
      { note: "tag-note", key: "tags", label: "list/tags(csv)" },
      { note: "num-note", key: "nonexistent", label: "absent(NullValue)" },
    ];

    const findEntry = (base) => entries.find((e) => e?.file?.basename === base) || null;
    const out = {};
    const seen = entries.map((e) => safe(() => e?.file?.basename));
    for (const pr of probes) {
      const e = findEntry(pr.note);
      if (!e) { out[`${pr.note}.${pr.key} [${pr.label}]`] = { error: "entry not found", seen }; continue; }
      const pid = `note.${pr.key}`;
      const v = safe(() => e.getValue(pid));
      out[`${pr.note}.${pr.key} [${pr.label}]`] = typeof v === "string" && v.startsWith("ERR:")
        ? { getValueError: v }
        : introspect(v);
    }
    return { out, seen };
  });
  result.valueProbes = probe.out;
  result.entriesSeen = probe.seen;
  rec("probe", "entriesSeen:", probe.seen);
  for (const [k, v] of Object.entries(probe.out)) rec("value", k, v);

  // ---- obsidian の Value export を確定（instanceof の正） ----
  const exportsProbe = await page.evaluate(() => {
    const safe = (fn) => { try { return fn(); } catch (e) { return `ERR:${String(e)}`; } };
    let obs = null;
    let via = null;
    // 1) require('obsidian')
    obs = safe(() => (typeof require === "function" ? require("obsidian") : null));
    if (obs && typeof obs === "object") via = "require('obsidian')";
    if (!obs || typeof obs !== "object") {
      // 2) 一部環境の global
      obs = safe(() => window.require && window.require("obsidian"));
      if (obs && typeof obs === "object") via = "window.require('obsidian')";
    }
    if (!obs || typeof obs !== "object") return { via: null, note: "require('obsidian') 取得不可", requireType: typeof require };

    const valueKeys = Object.keys(obs).filter((k) => /Value$/.test(k) && typeof obs[k] === "function");

    // 各フィクスチャの実 Value を各 Value クラスへ instanceof して確定する
    const p = window.app.plugins.plugins["eisenhower-bases-view"];
    const views = p && p.liveViews ? [...p.liveViews] : [];
    let entries = [];
    for (const v of views) { const d = v?.data?.data; if (Array.isArray(d) && d.length) { entries = d; break; } }
    const findEntry = (base) => entries.find((e) => e?.file?.basename === base) || null;
    const instanceMap = {};
    const targets = [
      { note: "num-note", key: "score", label: "number" },
      { note: "str-note", key: "level", label: "string" },
      { note: "tag-note", key: "tags", label: "list/tags" },
      { note: "bool-note", key: "flag", label: "boolean" },
      { note: "num-note", key: "nonexistent", label: "absent" },
    ];
    for (const t of targets) {
      const e = findEntry(t.note);
      const v = e && safe(() => e.getValue(`note.${t.key}`));
      const hits = valueKeys.filter((k) => safe(() => v instanceof obs[k]) === true);
      instanceMap[t.label] = { instanceofHits: hits, ctorName: safe(() => v && v.constructor && v.constructor.name) };
    }
    return { via, valueKeys, instanceMap };
  });
  result.obsidianExports = exportsProbe;
  rec("exports", JSON.stringify(exportsProbe));

  // ---- Bases options の型サーフェス（best-effort・§3.6④） ----
  const optionsProbe = await page.evaluate(() => {
    const safe = (fn) => { try { return fn(); } catch (e) { return `ERR:${String(e)}`; } };
    const bases = window.app.internalPlugins?.getPluginById?.("bases");
    const instance = bases?.instance;
    // registerBasesView の登録レジストリ・option 型の手掛かりになりそうなキーを列挙する
    return {
      basesInstanceKeys: safe(() => instance ? Object.keys(instance) : null),
      basesViewRegistryKeys: safe(() => instance?.registrations ? Object.keys(instance.registrations) : null),
      // 我々のビュー登録の options 宣言（実際に何を宣言できたか）
      ourViewRegistration: safe(() => {
        const reg = instance?.registrations?.["eisenhower-matrix"];
        return reg ? { keys: Object.keys(reg), optionsType: typeof reg.options } : null;
      }),
      note: "option 型（number/dropdown/toggle/条件付き）の可否は宣言 API 形状から推測。不確定なら手動 Configure view で確認",
    };
  });
  result.basesOptions = optionsProbe;
  rec("options", JSON.stringify(optionsProbe));

  dump();
  await browser.close();
  rec("summary", "S0 probe done");
  process.exit(0);
})().catch(async (e) => {
  rec("FATAL", String(e));
  dump();
  process.exit(1);
});
