import { describe, it, expect } from "vitest";
import { frontmatterValueToAxisRaw, axisSpecForWrite, planWriteBack } from "./writeBackPlan";
import type { AxisRaw, AxisSpec } from "../logic/axis";
import type { AxisWrite, FrontmatterLike } from "../logic/undo";
import type { WritableAxisKeys } from "./readAxis";
import type { NumberThresholds } from "./numberThreshold";
import type { AxisWriteValues } from "./types";

/**
 * #122 v0.3-1b（数値しきい値軸 書き戻し + undo）Red。
 *
 * 純モジュール `src/bases/writeBackPlan.ts`（設計承認 案B＝読取経路のミラー: present 値は型で kind 推定・
 * absent は threshold で解決）の契約を固定する:
 * - {@link frontmatterValueToAxisRaw}: plain frontmatter 値 → {@link AxisRaw}（欠損/null/undefined は absent）。
 * - {@link axisSpecForWrite}: threshold != null かつ current が number|absent のとき number spec、他は boolean spec。
 * - {@link planWriteBack}: 両軸で current → spec → `planAxisWrite` を通し、非 null プランのみ {@link AxisWrite} で返す。
 *
 * 既存の純ロジック（`planAxisWrite`＝number 越境は代表値/同側は null・boolean は常書き）へ配線するため、
 * 温存（AC2）・両軸代表値（AC5）・boolean 挙動不変（AC4）が planWriteBack で結線されることを検証する。
 */

// AxisRaw コンストラクタ（axis.test.ts と同じ流儀）。
const absent: AxisRaw = { kind: "absent" };
const boolRaw = (value: boolean): AxisRaw => ({ kind: "boolean", value });
const numRaw = (value: number): AxisRaw => ({ kind: "number", value });
const strRaw = (value: string): AxisRaw => ({ kind: "string", value });

// 書き戻し先キー（両軸とも書き戻し可能な note.* に解決済みの想定）。
const keys: WritableAxisKeys = { urgent: "urgent", important: "important" };

describe("frontmatterValueToAxisRaw — 欠損/null/undefined は absent（AC5 の入口）", () => {
  it("frontmatterValueToAxisRaw — キー欠損 → absent", () => {
    // given / when / then
    expect(frontmatterValueToAxisRaw({}, "urgent")).toEqual({ kind: "absent" });
  });
  it("frontmatterValueToAxisRaw — 値 null → absent（キーは在っても null は欠損扱い）", () => {
    // given / when / then
    expect(frontmatterValueToAxisRaw({ urgent: null }, "urgent")).toEqual({ kind: "absent" });
  });
  it("frontmatterValueToAxisRaw — 値 undefined → absent", () => {
    // given / when / then
    expect(frontmatterValueToAxisRaw({ urgent: undefined }, "urgent")).toEqual({ kind: "absent" });
  });
});

describe("frontmatterValueToAxisRaw — present 値は型で kind 推定（読取のミラー・案B）", () => {
  const presentCases: Array<{ name: string; value: unknown; expected: AxisRaw }> = [
    { name: "boolean true → {boolean,true}", value: true, expected: { kind: "boolean", value: true } },
    { name: "boolean false → {boolean,false}", value: false, expected: { kind: "boolean", value: false } },
    { name: "number 5 → {number,5}", value: 5, expected: { kind: "number", value: 5 } },
    { name: "number 0 → {number,0}（0 は実値・absent ではない）", value: 0, expected: { kind: "number", value: 0 } },
    { name: 'string "x" → {string,"x"}', value: "x", expected: { kind: "string", value: "x" } },
    { name: "array [1] → {array,[1]}", value: [1], expected: { kind: "array", value: [1] } },
  ];
  for (const c of presentCases) {
    it(`frontmatterValueToAxisRaw — ${c.name}`, () => {
      // given
      const frontmatter: FrontmatterLike = { prop: c.value };
      // when
      const raw = frontmatterValueToAxisRaw(frontmatter, "prop");
      // then
      expect(raw).toEqual(c.expected);
    });
  }

  it("frontmatterValueToAxisRaw — 想定外の値（オブジェクト）→ 文字列化フォールバック（防御的 catch-all）", () => {
    // given: boolean/number/string/array いずれでもない値（想定外・防御）
    const frontmatter: FrontmatterLike = { prop: { a: 1 } };
    // when
    const raw = frontmatterValueToAxisRaw(frontmatter, "prop");
    // then: String(value) で文字列へ落とす
    expect(raw).toEqual({ kind: "string", value: String({ a: 1 }) });
  });
});

describe("axisSpecForWrite — threshold と current から書き戻し spec を決める（案B）", () => {
  const specCases: Array<{ name: string; threshold: number | null; current: AxisRaw; expected: AxisSpec }> = [
    {
      name: "threshold=3 × number → number spec（present 数値は数値軸）",
      threshold: 3,
      current: numRaw(5),
      expected: { kind: "number", threshold: 3 },
    },
    {
      name: "threshold=3 × absent → number spec（AC5: 欠損もしきい値有効なら数値軸で代表値を書く）",
      threshold: 3,
      current: absent,
      expected: { kind: "number", threshold: 3 },
    },
    {
      name: "threshold=3 × boolean → boolean spec（読み書き対称: boolean 値は boolean のまま・数値で上書きしない）",
      threshold: 3,
      current: boolRaw(true),
      expected: { kind: "boolean" },
    },
    {
      name: "threshold=null × number → boolean spec（off-sentinel 防御既定・読取ロックで実際到達不能）",
      threshold: null,
      current: numRaw(5),
      expected: { kind: "boolean" },
    },
    {
      name: "threshold=null × absent → boolean spec（v1）",
      threshold: null,
      current: absent,
      expected: { kind: "boolean" },
    },
    {
      name: "threshold=3 × string → boolean spec（防御既定・読取ロックで実際到達不能）",
      threshold: 3,
      current: strRaw("x"),
      expected: { kind: "boolean" },
    },
  ];
  for (const c of specCases) {
    it(`axisSpecForWrite — ${c.name}`, () => {
      // given / when
      const spec = axisSpecForWrite(c.threshold, c.current);
      // then
      expect(spec).toEqual(c.expected);
    });
  }
});

describe("planWriteBack — 数値越境/温存の結線（AC1・AC2）", () => {
  it("planWriteBack — AC1 越境: 数値 1（threshold 3）を true 側へ → {urgent, 3}（highValue 未設定は threshold）", () => {
    // given: urgent=1（false 側）を true 側へ。important は boolean 軸（threshold null）で常書き。
    const frontmatter: FrontmatterLike = { urgent: 1 };
    const sides: AxisWriteValues = { urgent: true, important: false };
    const thresholds: NumberThresholds = { urgent: 3, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: urgent は越境で代表値 threshold=3 を書く
    expect(writes).toContainEqual({ key: "urgent", value: 3 });
  });

  it("planWriteBack — AC2 温存: 既に true 側の数値 5（threshold 3）→ urgent は書かない（数値 5 を温存）", () => {
    // given: urgent=5 は既に true 側。同側なので planAxisWrite が null を返し書き込まない。
    const frontmatter: FrontmatterLike = { urgent: 5 };
    const sides: AxisWriteValues = { urgent: true, important: true };
    const thresholds: NumberThresholds = { urgent: 3, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: urgent キーは書き込みリストに含まれない（5 を温存）
    expect(writes.map((write) => write.key)).not.toContain("urgent");
  });

  it("planWriteBack — AC2 部分温存（核心）: urgent=5 は温存・important=1 のみ越境 → [{important, 3}]", () => {
    // given: 両軸数値・両軸 true 目標。urgent は既に true 側（温存）・important は越境（代表値）。
    const frontmatter: FrontmatterLike = { urgent: 5, important: 1 };
    const sides: AxisWriteValues = { urgent: true, important: true };
    const thresholds: NumberThresholds = { urgent: 3, important: 3 };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: important だけを書く（urgent は不在＝5 を温存）
    expect(writes).toEqual([{ key: "important", value: 3 }]);
  });
});

describe("planWriteBack — absent は両軸代表値（AC5）", () => {
  it("planWriteBack — 両軸 absent + threshold 3 → true=high(3)・false=low(2) の代表値を両軸へ", () => {
    // given: 両軸欠損・しきい値有効。true 側は threshold（high 未設定）、false 側は threshold-1（low 未設定）。
    const frontmatter: FrontmatterLike = {};
    const sides: AxisWriteValues = { urgent: true, important: false };
    const thresholds: NumberThresholds = { urgent: 3, important: 3 };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: urgent=3（high=threshold）・important=2（low=threshold-1）を両軸に書く
    expect(writes).toEqual([
      { key: "urgent", value: 3 },
      { key: "important", value: 2 },
    ]);
  });
});

describe("planWriteBack — boolean 軸は挙動不変・常に書く（AC4 回帰）", () => {
  it("planWriteBack — threshold null（boolean 軸）× present boolean → 両軸を無条件に上書き", () => {
    // given: しきい値なし＝両軸 boolean。current に依らず side をそのまま書く。
    const frontmatter: FrontmatterLike = { urgent: true, important: false };
    const sides: AxisWriteValues = { urgent: false, important: true };
    const thresholds: NumberThresholds = { urgent: null, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then
    expect(writes).toEqual([
      { key: "urgent", value: false },
      { key: "important", value: true },
    ]);
  });

  it("planWriteBack — threshold null（boolean 軸）× 両軸 absent → boolean は absent でも両軸を書く", () => {
    // given: 欠損 + boolean 軸。boolean は常書きなので absent でも書き込む。
    const frontmatter: FrontmatterLike = {};
    const sides: AxisWriteValues = { urgent: false, important: true };
    const thresholds: NumberThresholds = { urgent: null, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then
    expect(writes).toEqual([
      { key: "urgent", value: false },
      { key: "important", value: true },
    ]);
  });

  it("planWriteBack — boolean 軸は同値でも書く（v1 の非温存）: urgent=true を true 側へ → {urgent, true}", () => {
    // given: 既に true の boolean を true 側へ。数値と違い boolean は温存しない（常に true/false を書く）。
    const frontmatter: FrontmatterLike = { urgent: true };
    const sides: AxisWriteValues = { urgent: true, important: false };
    const thresholds: NumberThresholds = { urgent: null, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: 同値でも urgent を書く（boolean は温存しない）
    expect(writes).toContainEqual({ key: "urgent", value: true });
  });
});

describe("planWriteBack — 防御既定: boolean spec は非 boolean の present 値を上書きしない（データ保護・#122 レビュー対応）", () => {
  // #34/#121 の読み取り側ロック（非 boolean note.* は掴めない）が主ガードだが、render↔write 間で
  // threshold が乖離（config.get の一過性 throw で write 時に null フォールバック）したりレースで非 boolean
  // 値に化けても、boolean 上書きによるデータ変換（数値→true/false 等）を起こさない深層防御を書き戻し側に敷く。
  it("planWriteBack — threshold null × 数値 5 → 数値を温存（boolean で上書きしない・off-sentinel）", () => {
    // given: off-sentinel（threshold 未設定）軸に数値 5。axisSpecForWrite は boolean spec に倒すが上書きしない。
    const frontmatter: FrontmatterLike = { urgent: 5 };
    const sides: AxisWriteValues = { urgent: true, important: false };
    const thresholds: NumberThresholds = { urgent: null, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: urgent（数値）は書き込みリストに含まれない（5 を温存）。important は boolean 軸 absent で書ける。
    expect(writes.map((write) => write.key)).not.toContain("urgent");
    expect(writes).toContainEqual({ key: "important", value: false });
  });

  it("planWriteBack — config.get throw で write 時 threshold=null に転んでも数値を温存（finding #1 の回帰）", () => {
    // given: render 時 threshold=5 で掴めた数値 10 が、write 時に threshold=null（config.get throw のフォールバック）
    //        へ転ぶ再現。boolean spec に倒れるが数値 10 を boolean で潰さない（silent なデータ変換を防ぐ）。
    const frontmatter: FrontmatterLike = { urgent: 10 };
    const sides: AxisWriteValues = { urgent: false, important: false };
    const thresholds: NumberThresholds = { urgent: null, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: 数値 10 は温存（書き込まれない）
    expect(writes.map((write) => write.key)).not.toContain("urgent");
  });

  it("planWriteBack — threshold 設定 × 文字列 present → 文字列を温存（型不一致を boolean で潰さない）", () => {
    // given: threshold 軸だが現在値が文字列（型不一致・通常は読取ロック）。boolean spec でも上書きしない。
    const frontmatter: FrontmatterLike = { urgent: "high" };
    const sides: AxisWriteValues = { urgent: true, important: false };
    const thresholds: NumberThresholds = { urgent: 3, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: 文字列は温存
    expect(writes.map((write) => write.key)).not.toContain("urgent");
  });

  it("planWriteBack — threshold 設定 × 配列 present → 配列を温存（tag 類を boolean で潰さない）", () => {
    // given: threshold 軸に配列（tags 類・通常は読取ロック）。boolean spec でも上書きしない。
    const frontmatter: FrontmatterLike = { urgent: ["work"] };
    const sides: AxisWriteValues = { urgent: true, important: false };
    const thresholds: NumberThresholds = { urgent: 3, important: null };
    // when
    const writes = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: 配列は温存
    expect(writes.map((write) => write.key)).not.toContain("urgent");
  });

  it("planWriteBack — boolean 軸 × boolean/absent は正当に書ける（ガードは boolean/absent を通す・AC4 不変）", () => {
    // given: 正当な boolean 軸の書き込み（present boolean・absent）はガードで止めない。
    const writesFromBool = planWriteBack(
      { urgent: true, important: false },
      keys,
      { urgent: false, important: true },
      { urgent: null, important: null },
    );
    const writesFromAbsent = planWriteBack(
      {},
      keys,
      { urgent: false, important: true },
      { urgent: null, important: null },
    );
    // then: どちらも両軸を書き込む（挙動不変）
    expect(writesFromBool).toEqual([
      { key: "urgent", value: false },
      { key: "important", value: true },
    ]);
    expect(writesFromAbsent).toEqual([
      { key: "urgent", value: false },
      { key: "important", value: true },
    ]);
  });
});

describe("planWriteBack — 返り値は AxisWrite 形（buildUndoEntries が消費可能・#105 連携）", () => {
  it("planWriteBack — 各要素は {key, value} 構造（undo のキーリスト機構へ渡せる）", () => {
    // given: 両軸とも書き込みが発生する構成
    const frontmatter: FrontmatterLike = {};
    const sides: AxisWriteValues = { urgent: true, important: false };
    const thresholds: NumberThresholds = { urgent: 3, important: 3 };
    // when
    const writes: AxisWrite[] = planWriteBack(frontmatter, keys, sides, thresholds);
    // then: buildUndoEntries が読む {key, value} 形（key は string・value フィールドを持つ）
    expect(writes.length).toBe(2);
    for (const write of writes) {
      expect(Object.keys(write).sort()).toEqual(["key", "value"]);
      expect(typeof write.key).toBe("string");
      expect("value" in write).toBe(true);
    }
  });
});

describe("axisSpecForWrite — 選択（select）軸の spec 供給（#123 v0.3-2）", () => {
  const selectValues = { trueValue: "high", falseValue: "low" };

  it("axisSpecForWrite — string current + selectValues → select spec", () => {
    expect(axisSpecForWrite(null, strRaw("high"), selectValues)).toEqual({
      kind: "select",
      trueValue: "high",
      falseValue: "low",
    });
  });

  it("axisSpecForWrite — absent + selectValues（threshold なし）→ select spec（新規分類で代表値を書ける）", () => {
    expect(axisSpecForWrite(null, absent, selectValues)).toEqual({
      kind: "select",
      trueValue: "high",
      falseValue: "low",
    });
  });

  it("axisSpecForWrite — absent で threshold と selectValues が両設定 → 数値軸を優先（読み取りと整合・決定）", () => {
    expect(axisSpecForWrite(3, absent, selectValues)).toEqual({ kind: "number", threshold: 3 });
  });

  it("axisSpecForWrite — selectValues なしの string は boolean spec（#34 不変・書き込み側で保護）", () => {
    expect(axisSpecForWrite(null, strRaw("high"))).toEqual({ kind: "boolean" });
  });
});

describe("planWriteBack — 選択（select）軸の書き戻し配線（#123 v0.3-2）", () => {
  const noThresholds: NumberThresholds = { urgent: null, important: null };
  // 緊急軸だけ select（high/low）、重要軸は select オフ。
  const selectValues = {
    urgent: { trueValue: "high", falseValue: "low" },
    important: null,
  };

  it("planWriteBack — 越境（low→true）は trueValue を書く（AC2）", () => {
    const frontmatter: FrontmatterLike = { urgent: "low", important: true };
    const sides: AxisWriteValues = { urgent: true, important: true };
    const writes = planWriteBack(frontmatter, keys, sides, noThresholds, selectValues);
    expect(writes).toContainEqual({ key: "urgent", value: "high" });
  });

  it("planWriteBack — 同じ側（high→true）は書かない（文字列を温存・AC2）", () => {
    const frontmatter: FrontmatterLike = { urgent: "high", important: true };
    const sides: AxisWriteValues = { urgent: true, important: true };
    const writes = planWriteBack(frontmatter, keys, sides, noThresholds, selectValues);
    expect(writes.find((w) => w.key === "urgent")).toBeUndefined();
  });

  it("planWriteBack — 未知値（medium・locked）へのドロップは書かない（既存値を保護・AC1/決定#3）", () => {
    const frontmatter: FrontmatterLike = { urgent: "medium", important: true };
    const sides: AxisWriteValues = { urgent: true, important: true };
    const writes = planWriteBack(frontmatter, keys, sides, noThresholds, selectValues);
    expect(writes.find((w) => w.key === "urgent")).toBeUndefined();
  });

  it("planWriteBack — absent の select 軸へ false ドロップは falseValue を書く（新規分類）", () => {
    const frontmatter: FrontmatterLike = { important: true };
    const sides: AxisWriteValues = { urgent: false, important: true };
    const writes = planWriteBack(frontmatter, keys, sides, noThresholds, selectValues);
    expect(writes).toContainEqual({ key: "urgent", value: "low" });
  });

  it("planWriteBack — selectValues 未指定なら文字列軸は書かない（既定オフ＝v1 不変）", () => {
    const frontmatter: FrontmatterLike = { urgent: "high", important: true };
    const sides: AxisWriteValues = { urgent: false, important: true };
    const writes = planWriteBack(frontmatter, keys, sides, noThresholds);
    expect(writes.find((w) => w.key === "urgent")).toBeUndefined();
  });
});
