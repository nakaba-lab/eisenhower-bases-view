import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import {
  IMPORTANT_NUMBER_THRESHOLD_OPTION_KEY,
  URGENT_NUMBER_THRESHOLD_OPTION_KEY,
  resolveNumberThresholds,
  toNumberThreshold,
} from "./numberThreshold";

/**
 * numberThreshold — 数値しきい値軸（#121 v0.3-1a）の per-axis しきい値解決
 * （ビュー options 主 + 設定既定＝ハイブリッド。滞留しきい値 `stagnationThreshold` と対称の numeric 版）。
 *
 * 滞留しきい値（非負整数・`0`＝オフ）と違い、数値軸しきい値は負値・小数も有効で `0` も有効値のため、
 * **「未設定（`null`）」を別 sentinel** にする（設定タブ空文字＋ビュー options 未設定＝当該軸の数値軸オフ）。
 */

const settings = (urgent: string, important: string) => ({
  ...DEFAULT_SETTINGS,
  defaultUrgencyThreshold: urgent,
  defaultImportanceThreshold: important,
});

describe("toNumberThreshold — 数値しきい値の生値正規化（#121）", () => {
  it("有限数はそのまま（負・小数・0 も有効値）", () => {
    // given/when/then: 滞留と違い 0 はオフ sentinel でなく有効なしきい値
    expect(toNumberThreshold(3)).toBe(3);
    expect(toNumberThreshold(0)).toBe(0);
    expect(toNumberThreshold(-2)).toBe(-2);
    expect(toNumberThreshold(3.5)).toBe(3.5);
  });

  it("数値文字列は数値化する（前後空白許容・負・小数も）", () => {
    expect(toNumberThreshold("3")).toBe(3);
    expect(toNumberThreshold("  -2 ")).toBe(-2);
    expect(toNumberThreshold("3.5")).toBe(3.5);
    expect(toNumberThreshold("0")).toBe(0);
  });

  it("空文字・空白のみは null（未設定＝数値軸オフ）", () => {
    expect(toNumberThreshold("")).toBeNull();
    expect(toNumberThreshold("   ")).toBeNull();
  });

  it("非数値・NaN・非有限・null/undefined は null（未設定へ倒す）", () => {
    expect(toNumberThreshold("abc")).toBeNull();
    expect(toNumberThreshold("3x")).toBeNull();
    expect(toNumberThreshold(Number.NaN)).toBeNull();
    expect(toNumberThreshold(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toNumberThreshold(null)).toBeNull();
    expect(toNumberThreshold(undefined)).toBeNull();
  });
});

describe("resolveNumberThresholds — per-axis ハイブリッド解決（options 主・設定既定・#121）", () => {
  it("既定（設定空・options 未設定）は両軸 null（数値軸オフ＝v1 挙動を維持）", () => {
    // given/when/then: 既定 DEFAULT_SETTINGS のしきい値は空文字（未設定）
    expect(resolveNumberThresholds(null, DEFAULT_SETTINGS)).toEqual({
      urgent: null,
      important: null,
    });
  });

  it("設定既定を per-axis で採用する（緊急・重要で別しきい値）", () => {
    expect(resolveNumberThresholds(null, settings("3", "5"))).toEqual({
      urgent: 3,
      important: 5,
    });
  });

  it("ビュー options を主に使う（設定既定より優先・per-axis・Base 単位の上書き）", () => {
    const config = {
      get: (key: string) =>
        key === URGENT_NUMBER_THRESHOLD_OPTION_KEY
          ? 10
          : key === IMPORTANT_NUMBER_THRESHOLD_OPTION_KEY
            ? 20
            : undefined,
    };
    expect(resolveNumberThresholds(config, settings("3", "5"))).toEqual({
      urgent: 10,
      important: 20,
    });
  });

  it("options が 0（有効なしきい値）なら 0 を採用しフォールバックしない", () => {
    // given: 0 は有効値（?? で潰さない）
    const config = { get: () => 0 };
    expect(resolveNumberThresholds(config, settings("3", "5"))).toEqual({
      urgent: 0,
      important: 0,
    });
  });

  it("片軸だけ options 設定なら他方は設定既定へフォールバック", () => {
    const config = {
      get: (key: string) => (key === URGENT_NUMBER_THRESHOLD_OPTION_KEY ? 10 : undefined),
    };
    expect(resolveNumberThresholds(config, settings("3", "5"))).toEqual({
      urgent: 10,
      important: 5,
    });
  });

  it("config が null/undefined でも落ちず設定既定を返す", () => {
    expect(resolveNumberThresholds(null, settings("2", "4"))).toEqual({
      urgent: 2,
      important: 4,
    });
    expect(resolveNumberThresholds(undefined, settings("2", "4"))).toEqual({
      urgent: 2,
      important: 4,
    });
  });

  it("config.get が throw しても設定既定へ退避する（churn 耐性・滞留しきい値と対称）", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const config = {
      get: () => {
        throw new Error("bases churn");
      },
    };
    expect(resolveNumberThresholds(config, settings("3", "5"))).toEqual({
      urgent: 3,
      important: 5,
    });
    spy.mockRestore();
  });
});
