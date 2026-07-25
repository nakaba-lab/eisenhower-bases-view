import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type EisenhowerSettings } from "../settings";
import {
  IMPORTANT_SELECT_FALSE_OPTION_KEY,
  IMPORTANT_SELECT_TRUE_OPTION_KEY,
  URGENT_SELECT_FALSE_OPTION_KEY,
  URGENT_SELECT_TRUE_OPTION_KEY,
  normalizeSelectValue,
  resolveSelectValues,
  toSelectValues,
} from "./selectValues";

/**
 * #123 v0.3-2（選択（select）軸アダプタ配線）Red。
 *
 * 純ラッパ `src/bases/selectValues.ts`（`numberThreshold.ts` の写し）の契約を固定する:
 * - {@link normalizeSelectValue}: 文字列をトリムし、空文字・非文字列は `null`。
 * - {@link toSelectValues}: 両値が非 null かつ**互いに異なる**とき `{trueValue,falseValue}`、他は `null`。
 * - {@link resolveSelectValues}: per-axis でビュー options 主・設定既定フォールバック・`config.get` throw を境界退避。
 */

function settingsWith(overrides: Partial<EisenhowerSettings>): EisenhowerSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("normalizeSelectValue — トリム・空/非文字列は null", () => {
  it("normalizeSelectValue — 文字列は前後トリムして返す", () => {
    expect(normalizeSelectValue(" high ")).toBe("high");
    expect(normalizeSelectValue("low")).toBe("low");
  });
  it("normalizeSelectValue — 空文字・空白のみ・非文字列は null（オフ）", () => {
    expect(normalizeSelectValue("")).toBeNull();
    expect(normalizeSelectValue("   ")).toBeNull();
    expect(normalizeSelectValue(undefined)).toBeNull();
    expect(normalizeSelectValue(null)).toBeNull();
    expect(normalizeSelectValue(3)).toBeNull();
  });
});

describe("toSelectValues — 両値非空かつ異なるときだけ SelectValues", () => {
  it("toSelectValues — 両値が非空で異なる → {trueValue,falseValue}", () => {
    expect(toSelectValues("high", "low")).toEqual({ trueValue: "high", falseValue: "low" });
  });
  it("toSelectValues — 片方でも null（未設定）→ null（二値軸オフ）", () => {
    expect(toSelectValues("high", null)).toBeNull();
    expect(toSelectValues(null, "low")).toBeNull();
    expect(toSelectValues(null, null)).toBeNull();
  });
  it("toSelectValues — 同値 → null（二値軸として成立しない・後勝ちで潰れる設定ミス）", () => {
    expect(toSelectValues("same", "same")).toBeNull();
  });
});

describe("resolveSelectValues — options 主・設定既定フォールバック（per-axis）", () => {
  it("resolveSelectValues — 設定既定（両値）から解決する（options 未設定）", () => {
    // given: 緊急度だけ select 設定、重要度は未設定
    const settings = settingsWith({
      defaultUrgencySelectTrueValue: "high",
      defaultUrgencySelectFalseValue: "low",
    });
    // when
    const resolved = resolveSelectValues(null, settings);
    // then
    expect(resolved.urgent).toEqual({ trueValue: "high", falseValue: "low" });
    expect(resolved.important).toBeNull();
  });

  it("resolveSelectValues — ビュー options が設定既定を上書きする（主）", () => {
    // given: 設定既定はあるが options が上書き
    const settings = settingsWith({
      defaultUrgencySelectTrueValue: "high",
      defaultUrgencySelectFalseValue: "low",
    });
    const config = {
      get: (key: string) =>
        ({
          [URGENT_SELECT_TRUE_OPTION_KEY]: "done",
          [URGENT_SELECT_FALSE_OPTION_KEY]: "todo",
        })[key],
    };
    // when
    const resolved = resolveSelectValues(config, settings);
    // then: options 値が優先
    expect(resolved.urgent).toEqual({ trueValue: "done", falseValue: "todo" });
  });

  it("resolveSelectValues — 重要度軸も options から解決できる", () => {
    const config = {
      get: (key: string) =>
        ({
          [IMPORTANT_SELECT_TRUE_OPTION_KEY]: "A",
          [IMPORTANT_SELECT_FALSE_OPTION_KEY]: "B",
        })[key],
    };
    const resolved = resolveSelectValues(config, DEFAULT_SETTINGS);
    expect(resolved.important).toEqual({ trueValue: "A", falseValue: "B" });
    expect(resolved.urgent).toBeNull();
  });

  it("resolveSelectValues — 既定は両軸オフ（select 未設定＝v1 挙動を維持）", () => {
    expect(resolveSelectValues(null, DEFAULT_SETTINGS)).toEqual({ urgent: null, important: null });
  });

  it("resolveSelectValues — 片方だけ設定・同値は null（二値軸として成立しない）", () => {
    const onlyTrue = settingsWith({ defaultUrgencySelectTrueValue: "high" });
    expect(resolveSelectValues(null, onlyTrue).urgent).toBeNull();
    const same = settingsWith({
      defaultUrgencySelectTrueValue: "x",
      defaultUrgencySelectFalseValue: "x",
    });
    expect(resolveSelectValues(null, same).urgent).toBeNull();
  });

  it("resolveSelectValues — ビュー options が片方だけ指定なら設定既定と混ぜない（pair をアトミック解決・レビュー指摘）", () => {
    // given: 設定既定は high/low。ビューは trueValue だけ 'done' を指定（falseValue はビュー未設定）。
    const settings = settingsWith({
      defaultUrgencySelectTrueValue: "high",
      defaultUrgencySelectFalseValue: "low",
    });
    const config = {
      get: (key: string) => ({ [URGENT_SELECT_TRUE_OPTION_KEY]: "done" })[key],
    };
    // when
    const resolved = resolveSelectValues(config, settings);
    // then: 設定既定の 'low' を借りて {done, low} の混成 pair を作らない。ビューが片方でも指定したら
    // ビューの pair（この場合 false 側欠落＝不完全）を採る＝混成語彙を生まない（アトミック解決）。
    expect(resolved.urgent).toBeNull();
  });

  it("resolveSelectValues — ビュー options が両値指定なら設定既定を一切借りない（ビューの pair をそのまま）", () => {
    // given: 設定既定 high/low、ビューは done/todo を両方指定
    const settings = settingsWith({
      defaultUrgencySelectTrueValue: "high",
      defaultUrgencySelectFalseValue: "low",
    });
    const config = {
      get: (key: string) =>
        ({
          [URGENT_SELECT_TRUE_OPTION_KEY]: "done",
          [URGENT_SELECT_FALSE_OPTION_KEY]: "todo",
        })[key],
    };
    // when / then: ビューの pair をアトミックに採用（設定既定は混ざらない）
    expect(resolveSelectValues(config, settings).urgent).toEqual({
      trueValue: "done",
      falseValue: "todo",
    });
  });

  it("resolveSelectValues — config.get が throw しても境界退避して設定既定へ倒す", () => {
    const settings = settingsWith({
      defaultUrgencySelectTrueValue: "high",
      defaultUrgencySelectFalseValue: "low",
    });
    const throwingConfig = {
      get: () => {
        throw new Error("churn");
      },
    };
    // then: throw を握って設定既定で解決（ビュー全体を壊さない）
    expect(resolveSelectValues(throwingConfig, settings).urgent).toEqual({
      trueValue: "high",
      falseValue: "low",
    });
  });
});
