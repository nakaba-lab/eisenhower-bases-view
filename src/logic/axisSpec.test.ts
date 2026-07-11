import { describe, it, expect } from "vitest";
import {
  interpretAxis,
  planAxisWrite,
  type AxisSpec,
  type AxisRaw,
  type AxisInterpretation,
} from "./axisSpec";

// F0（v0.3 軸の一般化・#120）の純ロジック仕様。
// interpretAxis: 型付き生値（AxisRaw）× 軸仕様（AxisSpec）→ 軸の側（boolean|undefined）+ locked。
// planAxisWrite: 目標の側 × 軸仕様 × 現在値 → 書き込みプラン（null=書かない＝値温存）。
// 象限ロジック（classifyQuadrant）は不変で、本モジュールは「値→側」「側→書き込み」の両端だけを一般化する。
// 設計は docs/superpowers/specs/2026-07-11-axis-generalization-v0.3-design.md §3。

const BOOL: AxisSpec = { kind: "boolean" };
const NUM: AxisSpec = { kind: "number", threshold: 3 };
const NUM_REP: AxisSpec = { kind: "number", threshold: 3, highValue: 5, lowValue: 1 };
const SEL: AxisSpec = { kind: "select", trueValue: "high", falseValue: "low" };
const TAG: AxisSpec = { kind: "tag", tagName: "urgent" };

describe("interpretAxis — absent / unsupported は全 spec で共通", () => {
  const specs: Array<{ name: string; spec: AxisSpec }> = [
    { name: "boolean", spec: BOOL },
    { name: "number", spec: NUM },
    { name: "select", spec: SEL },
    { name: "tag", spec: TAG },
  ];
  for (const { name, spec } of specs) {
    it(`interpretAxis — ${name} × absent → 未分類・ドラッグ可（locked=false）`, () => {
      // given / when
      const r = interpretAxis({ kind: "absent" }, spec);
      // then: 欠損は新規分類できるので locked にしない
      expect(r).toEqual<AxisInterpretation>({ side: undefined, locked: false });
    });
    it(`interpretAxis — ${name} × unsupported → 未分類・安全側ロック（locked=true）`, () => {
      const r = interpretAxis({ kind: "unsupported" }, spec);
      expect(r).toEqual<AxisInterpretation>({ side: undefined, locked: true });
    });
  }
});

describe("interpretAxis — boolean spec", () => {
  it("boolean 値 true → side=true・locked=false", () => {
    expect(interpretAxis({ kind: "boolean", value: true }, BOOL)).toEqual({ side: true, locked: false });
  });
  it("boolean 値 false → side=false・locked=false", () => {
    expect(interpretAxis({ kind: "boolean", value: false }, BOOL)).toEqual({ side: false, locked: false });
  });
  it("非 boolean（数値）present → 未分類・locked（#34 の破壊防止）", () => {
    expect(interpretAxis({ kind: "number", value: 1 }, BOOL)).toEqual({ side: undefined, locked: true });
  });
});

describe("interpretAxis — number spec（threshold=3）", () => {
  const cases: Array<{ name: string; raw: AxisRaw; side: boolean | undefined; locked: boolean }> = [
    { name: "5 は threshold 以上 → true", raw: { kind: "number", value: 5 }, side: true, locked: false },
    { name: "3 は境界ちょうど（>=）→ true", raw: { kind: "number", value: 3 }, side: true, locked: false },
    { name: "2 は threshold 未満 → false", raw: { kind: "number", value: 2 }, side: false, locked: false },
    { name: "NaN は未分類・locked", raw: { kind: "number", value: NaN }, side: undefined, locked: true },
    { name: "+Infinity は未分類・locked", raw: { kind: "number", value: Infinity }, side: undefined, locked: true },
    { name: "-Infinity は未分類・locked", raw: { kind: "number", value: -Infinity }, side: undefined, locked: true },
    { name: "型不一致（文字列）present は未分類・locked", raw: { kind: "string", value: "3" }, side: undefined, locked: true },
  ];
  for (const c of cases) {
    it(`number — ${c.name}`, () => {
      expect(interpretAxis(c.raw, NUM)).toEqual({ side: c.side, locked: c.locked });
    });
  }
});

describe("interpretAxis — select spec（high/low）", () => {
  it("trueValue 一致 → true", () => {
    expect(interpretAxis({ kind: "string", value: "high" }, SEL)).toEqual({ side: true, locked: false });
  });
  it("falseValue 一致 → false", () => {
    expect(interpretAxis({ kind: "string", value: "low" }, SEL)).toEqual({ side: false, locked: false });
  });
  it("未知値（medium）→ 未分類・locked（未知値を書き潰さない）", () => {
    expect(interpretAxis({ kind: "string", value: "medium" }, SEL)).toEqual({ side: undefined, locked: true });
  });
  it("型不一致（数値）present → 未分類・locked", () => {
    expect(interpretAxis({ kind: "number", value: 1 }, SEL)).toEqual({ side: undefined, locked: true });
  });
});

describe("interpretAxis — tag spec（tagName=urgent）", () => {
  it("リストに tagName を含む → true・locked=false", () => {
    expect(interpretAxis({ kind: "list", values: ["urgent", "work"] }, TAG)).toEqual({ side: true, locked: false });
  });
  it("リスト present だが tagName 無し → false", () => {
    expect(interpretAxis({ kind: "list", values: ["work"] }, TAG)).toEqual({ side: false, locked: false });
  });
  it("空リスト → false（present だがタグ無し）", () => {
    expect(interpretAxis({ kind: "list", values: [] }, TAG)).toEqual({ side: false, locked: false });
  });
  it("`#` 前置・大小差を正規化して一致（#Urgent も含む扱い）", () => {
    // 実機の Value 層はタグを `#urgent`（`#` 前置）で返す。F0 は正規化して比較し、
    // アダプタが bare / `#` 付きどちらを渡しても同じ結果にする（3b の `#` 吸収を logic 層で担保）。
    expect(interpretAxis({ kind: "list", values: ["#Urgent"] }, TAG)).toEqual({ side: true, locked: false });
  });
  it("非リスト（文字列）present → 未分類・locked", () => {
    expect(interpretAxis({ kind: "string", value: "urgent" }, TAG)).toEqual({ side: undefined, locked: true });
  });
});

describe("planAxisWrite — boolean spec（挙動不変: 常に書く）", () => {
  it("side=true → { value: true }", () => {
    expect(planAxisWrite(true, BOOL, { kind: "boolean", value: false })).toEqual({ value: true });
  });
  it("side=false → { value: false }", () => {
    expect(planAxisWrite(false, BOOL, { kind: "boolean", value: true })).toEqual({ value: false });
  });
  it("既に同値でも書く（両軸明示書き込みの挙動不変）", () => {
    expect(planAxisWrite(true, BOOL, { kind: "boolean", value: true })).toEqual({ value: true });
  });
});

describe("planAxisWrite — number spec（同じ側は書かない・越境時のみ代表値）", () => {
  it("既に true 側（5>=3）× side=true → null（値温存）", () => {
    expect(planAxisWrite(true, NUM_REP, { kind: "number", value: 5 })).toBeNull();
  });
  it("既に false 側（2<3）× side=false → null（値温存）", () => {
    expect(planAxisWrite(false, NUM_REP, { kind: "number", value: 2 })).toBeNull();
  });
  it("false 側（2）→ true へ越境 → highValue(5) を書く", () => {
    expect(planAxisWrite(true, NUM_REP, { kind: "number", value: 2 })).toEqual({ value: 5 });
  });
  it("true 側（5）→ false へ越境 → lowValue(1) を書く", () => {
    expect(planAxisWrite(false, NUM_REP, { kind: "number", value: 5 })).toEqual({ value: 1 });
  });
  it("代表値未指定 → highValue 既定 = threshold(3)", () => {
    expect(planAxisWrite(true, NUM, { kind: "number", value: 1 })).toEqual({ value: 3 });
  });
  it("代表値未指定 → lowValue 既定 = threshold-1(2)", () => {
    expect(planAxisWrite(false, NUM, { kind: "number", value: 5 })).toEqual({ value: 2 });
  });
  it("absent から true へ分類 → 代表値を書く", () => {
    expect(planAxisWrite(true, NUM_REP, { kind: "absent" })).toEqual({ value: 5 });
  });
});

describe("planAxisWrite — select spec", () => {
  it("既に trueValue × side=true → null", () => {
    expect(planAxisWrite(true, SEL, { kind: "string", value: "high" })).toBeNull();
  });
  it("越境（low→high）→ trueValue を書く", () => {
    expect(planAxisWrite(true, SEL, { kind: "string", value: "low" })).toEqual({ value: "high" });
  });
  it("越境（high→low）→ falseValue を書く", () => {
    expect(planAxisWrite(false, SEL, { kind: "string", value: "high" })).toEqual({ value: "low" });
  });
  it("absent から分類 → 目標値を書く", () => {
    expect(planAxisWrite(false, SEL, { kind: "absent" })).toEqual({ value: "low" });
  });
});

describe("planAxisWrite — tag spec（配列 add/remove・他要素温存）", () => {
  it("side=true × tagName 無し → 末尾に追加（他要素温存）", () => {
    expect(planAxisWrite(true, TAG, { kind: "list", values: ["work"] })).toEqual({ value: ["work", "urgent"] });
  });
  it("side=true × 既に含む → null（書かない）", () => {
    expect(planAxisWrite(true, TAG, { kind: "list", values: ["urgent", "work"] })).toBeNull();
  });
  it("side=false × 含む → tagName のみ除去（他要素温存）", () => {
    expect(planAxisWrite(false, TAG, { kind: "list", values: ["urgent", "work"] })).toEqual({ value: ["work"] });
  });
  it("side=false × 含まない → null（除去対象なし）", () => {
    expect(planAxisWrite(false, TAG, { kind: "list", values: ["work"] })).toBeNull();
  });
  it("side=true × absent → 新規配列 [tagName]", () => {
    expect(planAxisWrite(true, TAG, { kind: "absent" })).toEqual({ value: ["urgent"] });
  });
  it("除去は `#` 前置・大小差を正規化して一致させる（#Urgent を除去）", () => {
    expect(planAxisWrite(false, TAG, { kind: "list", values: ["#Urgent", "work"] })).toEqual({ value: ["work"] });
  });
});
