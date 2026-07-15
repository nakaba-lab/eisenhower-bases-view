import { describe, it, expect } from "vitest";
import {
  interpretAxis,
  planAxisWrite,
  type AxisSpec,
  type AxisRaw,
  type AxisReading,
} from "./axis";

// spec フィクスチャ（#120 F0・設計書 docs/design/bases.md「AxisSpec 基盤」§3.3 再構成表）。
const booleanSpec: AxisSpec = { kind: "boolean" };
const numberSpec: AxisSpec = { kind: "number", threshold: 3 };
const numberSpecRepr: AxisSpec = {
  kind: "number",
  threshold: 3,
  highValue: 10,
  lowValue: 0,
};
const selectSpec: AxisSpec = { kind: "select", trueValue: "high", falseValue: "low" };
const tagSpec: AxisSpec = { kind: "tag", tag: "urgent" };

// AxisRaw コンストラクタ（型正規化済みの生値＝アダプタが instanceof で振り分けた結果）。
const absent: AxisRaw = { kind: "absent" };
const boolRaw = (value: boolean): AxisRaw => ({ kind: "boolean", value });
const numRaw = (value: number): AxisRaw => ({ kind: "number", value });
const strRaw = (value: string): AxisRaw => ({ kind: "string", value });
const arrRaw = (value: readonly unknown[]): AxisRaw => ({ kind: "array", value });

describe("interpretAxis — §3.3 再構成表（kind × raw → {side, locked}）", () => {
  // セル記法: 未対応（型不一致）= undefined/locked、absent = undefined/unlocked。
  const cases: Array<{ name: string; spec: AxisSpec; raw: AxisRaw; expected: AxisReading }> = [
    // --- boolean spec ---
    { name: "boolean × absent → 未分類・非ロック", spec: booleanSpec, raw: absent, expected: { side: undefined, locked: false } },
    { name: "boolean × boolean(true) → true・非ロック", spec: booleanSpec, raw: boolRaw(true), expected: { side: true, locked: false } },
    { name: "boolean × boolean(false) → false・非ロック", spec: booleanSpec, raw: boolRaw(false), expected: { side: false, locked: false } },
    { name: "boolean × number → 未対応（保護ロック）", spec: booleanSpec, raw: numRaw(1), expected: { side: undefined, locked: true } },
    { name: "boolean × string → 未対応（保護ロック）", spec: booleanSpec, raw: strRaw("x"), expected: { side: undefined, locked: true } },
    { name: "boolean × array → 未対応（保護ロック）", spec: booleanSpec, raw: arrRaw(["a"]), expected: { side: undefined, locked: true } },

    // --- number spec (threshold 3) ---
    { name: "number × absent → 未分類・非ロック", spec: numberSpec, raw: absent, expected: { side: undefined, locked: false } },
    { name: "number × boolean → 未対応（保護ロック）", spec: numberSpec, raw: boolRaw(true), expected: { side: undefined, locked: true } },
    { name: "number × number(5≥3) → true 側", spec: numberSpec, raw: numRaw(5), expected: { side: true, locked: false } },
    { name: "number × number(3＝境界) → true 側（境界ちょうどは true）", spec: numberSpec, raw: numRaw(3), expected: { side: true, locked: false } },
    { name: "number × number(2<3) → false 側", spec: numberSpec, raw: numRaw(2), expected: { side: false, locked: false } },
    { name: "number × string → 未対応（保護ロック）", spec: numberSpec, raw: strRaw("3"), expected: { side: undefined, locked: true } },
    { name: "number × array → 未対応（保護ロック）", spec: numberSpec, raw: arrRaw([3]), expected: { side: undefined, locked: true } },

    // --- select spec (trueValue "high" / falseValue "low") ---
    { name: "select × absent → 未分類・非ロック", spec: selectSpec, raw: absent, expected: { side: undefined, locked: false } },
    { name: "select × boolean → 未対応（保護ロック）", spec: selectSpec, raw: boolRaw(true), expected: { side: undefined, locked: true } },
    { name: "select × number → 未対応（保護ロック）", spec: selectSpec, raw: numRaw(1), expected: { side: undefined, locked: true } },
    { name: "select × string(=trueValue) → true 側", spec: selectSpec, raw: strRaw("high"), expected: { side: true, locked: false } },
    { name: "select × string(=falseValue) → false 側", spec: selectSpec, raw: strRaw("low"), expected: { side: false, locked: false } },
    { name: "select × string(異物値) → 未分類・保護ロック（決定#3）", spec: selectSpec, raw: strRaw("medium"), expected: { side: undefined, locked: true } },
    { name: "select × array → 未対応（保護ロック）", spec: selectSpec, raw: arrRaw(["high"]), expected: { side: undefined, locked: true } },

    // --- tag spec (tag "urgent") ---
    { name: "tag × absent → 未分類・非ロック", spec: tagSpec, raw: absent, expected: { side: undefined, locked: false } },
    { name: "tag × boolean → 未対応（保護ロック）", spec: tagSpec, raw: boolRaw(true), expected: { side: undefined, locked: true } },
    { name: "tag × number → 未対応（保護ロック）", spec: tagSpec, raw: numRaw(1), expected: { side: undefined, locked: true } },
    { name: "tag × string → 未対応（保護ロック）", spec: tagSpec, raw: strRaw("urgent"), expected: { side: undefined, locked: true } },
    { name: "tag × array(所属) → true 側・非ロック", spec: tagSpec, raw: arrRaw(["urgent", "work"]), expected: { side: true, locked: false } },
    { name: "tag × array(非所属) → false 側に確定（決定#4）", spec: tagSpec, raw: arrRaw(["work"]), expected: { side: false, locked: false } },
    { name: "tag × array(空) → false 側・非ロック", spec: tagSpec, raw: arrRaw([]), expected: { side: false, locked: false } },
  ];

  for (const c of cases) {
    it(`interpretAxis — ${c.name}`, () => {
      // given / when
      const result = interpretAxis(c.raw, c.spec);
      // then
      expect(result).toEqual(c.expected);
    });
  }
});

describe("interpretAxis — number の非有限値は保護ロック（AC3）", () => {
  const nonFinite: Array<{ name: string; value: number }> = [
    { name: "NaN", value: Number.NaN },
    { name: "+Infinity", value: Number.POSITIVE_INFINITY },
    { name: "-Infinity", value: Number.NEGATIVE_INFINITY },
  ];
  for (const c of nonFinite) {
    it(`interpretAxis — number × ${c.name} → 未分類・ロック`, () => {
      // given / when / then
      expect(interpretAxis(numRaw(c.value), numberSpec)).toEqual({ side: undefined, locked: true });
    });
  }
});

describe("planAxisWrite — boolean は常に true/false（挙動不変・AC7）", () => {
  it("planAxisWrite — boolean × side=true は current に依らず {value:true}", () => {
    // given / when / then: 既に true でも温存せず必ず書く（v1 挙動不変）
    expect(planAxisWrite(true, booleanSpec, boolRaw(true))).toEqual({ value: true });
  });
  it("planAxisWrite — boolean × side=false は current=absent でも {value:false}", () => {
    expect(planAxisWrite(false, booleanSpec, absent)).toEqual({ value: false });
  });
  it("planAxisWrite — boolean × side=true は current=absent でも {value:true}", () => {
    expect(planAxisWrite(true, booleanSpec, absent)).toEqual({ value: true });
  });
});

describe("planAxisWrite — 既に目標側なら null＝値温存（AC4）", () => {
  it("planAxisWrite — number × 既に true 側(5) へ true → null（数値 5 を温存）", () => {
    // given / when / then
    expect(planAxisWrite(true, numberSpecRepr, numRaw(5))).toBeNull();
  });
  it("planAxisWrite — number × 既に false 側(1) へ false → null", () => {
    expect(planAxisWrite(false, numberSpecRepr, numRaw(1))).toBeNull();
  });
  it("planAxisWrite — select × 既に trueValue へ true → null（文字列温存）", () => {
    expect(planAxisWrite(true, selectSpec, strRaw("high"))).toBeNull();
  });
  it("planAxisWrite — tag × 既に所属へ true → null（配列温存）", () => {
    expect(planAxisWrite(true, tagSpec, arrRaw(["urgent", "work"]))).toBeNull();
  });
  it("planAxisWrite — tag × 既に非所属へ false → null", () => {
    expect(planAxisWrite(false, tagSpec, arrRaw(["work"]))).toBeNull();
  });
});

describe("planAxisWrite — 越境/absent は代表値（AC5・number/select）", () => {
  it("planAxisWrite — number × 越境(1→true) は highValue", () => {
    expect(planAxisWrite(true, numberSpecRepr, numRaw(1))).toEqual({ value: 10 });
  });
  it("planAxisWrite — number × 越境(5→false) は lowValue", () => {
    expect(planAxisWrite(false, numberSpecRepr, numRaw(5))).toEqual({ value: 0 });
  });
  it("planAxisWrite — number × absent→true は highValue", () => {
    expect(planAxisWrite(true, numberSpecRepr, absent)).toEqual({ value: 10 });
  });
  it("planAxisWrite — number × highValue 未設定なら threshold（true）", () => {
    expect(planAxisWrite(true, numberSpec, numRaw(1))).toEqual({ value: 3 });
  });
  it("planAxisWrite — number × lowValue 未設定なら threshold-1（false）", () => {
    expect(planAxisWrite(false, numberSpec, numRaw(5))).toEqual({ value: 2 });
  });
  it("planAxisWrite — select × 越境(low→true) は trueValue", () => {
    expect(planAxisWrite(true, selectSpec, strRaw("low"))).toEqual({ value: "high" });
  });
  it("planAxisWrite — select × absent→false は falseValue", () => {
    expect(planAxisWrite(false, selectSpec, absent)).toEqual({ value: "low" });
  });
  it("planAxisWrite — select × 越境(high→false) は falseValue（trueValue→false の対称）", () => {
    expect(planAxisWrite(false, selectSpec, strRaw("high"))).toEqual({ value: "low" });
  });
});

describe("planAxisWrite — locked な current は保護（number/select/tag は null・防御的深層防御）", () => {
  // 通常 locked のカードは UI がドラッグを封じるが、基盤モジュール自身も present だが解釈不能な
  // 既存値の上書きを拒む（決定#3・#34 の一般化を planAxisWrite 側でも二重化）。
  it("planAxisWrite — select × 異物値(locked) へ true → null（既存値を保護・決定#3）", () => {
    // given / when / then: "medium" は trueValue/falseValue のどちらでもない＝locked
    expect(planAxisWrite(true, selectSpec, strRaw("medium"))).toBeNull();
  });
  it("planAxisWrite — number × NaN(locked) へ true → null（保護）", () => {
    expect(planAxisWrite(true, numberSpec, numRaw(Number.NaN))).toBeNull();
  });
  it("planAxisWrite — tag × 非配列(locked) へ true → null（保護）", () => {
    expect(planAxisWrite(true, tagSpec, strRaw("urgent"))).toBeNull();
  });
  it("planAxisWrite — boolean は locked な current でも常に書く（AC7 挙動不変・#34 が別途保護）", () => {
    // boolean は AC7 のため locked-guard の対象外＝常に true/false（非 boolean の保護は #34 の
    // 読み取り側〔未分類化〕・UI ロック・書き戻し側 note.* ガードで担保する）。
    expect(planAxisWrite(true, booleanSpec, numRaw(1))).toEqual({ value: true });
  });
});

describe("planAxisWrite — tag は配列 add/remove（他要素温存・AC6）", () => {
  it("planAxisWrite — tag × 非所属へ true は末尾に add（他タグ温存）", () => {
    // given / when
    const plan = planAxisWrite(true, tagSpec, arrRaw(["work"]));
    // then
    expect(plan).toEqual({ value: ["work", "urgent"] });
  });
  it("planAxisWrite — tag × 所属へ false は remove（他タグ温存）", () => {
    expect(planAxisWrite(false, tagSpec, arrRaw(["urgent", "work"]))).toEqual({ value: ["work"] });
  });
  it("planAxisWrite — tag × absent→true は tag 1 個の新配列", () => {
    expect(planAxisWrite(true, tagSpec, absent)).toEqual({ value: ["urgent"] });
  });
  it("planAxisWrite — tag × absent→false は空配列（未分類→false 側を確定）", () => {
    // absent は interpretAxis で未分類（undefined）＝目標 false と不一致のため、[] を書いて false 側にする。
    expect(planAxisWrite(false, tagSpec, absent)).toEqual({ value: [] });
  });
  it("planAxisWrite — tag は current 配列を破壊的変更しない（新配列を返す）", () => {
    // given
    const current = ["work"];
    // when
    planAxisWrite(true, tagSpec, arrRaw(current));
    // then: 入力配列は不変
    expect(current).toEqual(["work"]);
  });
});
