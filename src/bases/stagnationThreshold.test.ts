import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import {
  STAGNATION_OPTION_KEY,
  resolveStagnationThresholdDays,
} from "./stagnationThreshold";

/**
 * stagnationThreshold — 滞留しきい値の解決（ビュー options 主 + グローバル既定＝ハイブリッド・#106）。
 *
 * 軸プロパティ（F4/#21）と同じハイブリッド: ビュー options（`config.get(KEY)`）を主とし、
 * 未設定・不正なら設定 `stagnationThresholdDays`（既定 14）にフォールバックする。Bases 接触点
 * （`config.get`）は churn 対象のため throw を境界で退避する（`safeGetAsPropertyId` と対称）。
 */

const settings = (days: number) => ({ ...DEFAULT_SETTINGS, stagnationThresholdDays: days });

describe("resolveStagnationThresholdDays — ハイブリッド解決（#106）", () => {
  it("resolveStagnationThresholdDays — ビュー options に有効な数値があればそれを主に使う", () => {
    // given: options で 30 を設定（Base ごとの上書き）
    const config = { get: (key: string) => (key === STAGNATION_OPTION_KEY ? 30 : undefined) };
    // when / then: 設定既定 14 ではなく options の 30 が勝つ
    expect(resolveStagnationThresholdDays(config, settings(14))).toBe(30);
  });

  it("resolveStagnationThresholdDays — options 未設定（undefined）なら設定既定にフォールバック", () => {
    // given: options にキーが無い
    const config = { get: () => undefined };
    // when / then
    expect(resolveStagnationThresholdDays(config, settings(14))).toBe(14);
  });

  it("resolveStagnationThresholdDays — config が null でも落ちず設定既定を返す", () => {
    expect(resolveStagnationThresholdDays(null, settings(21))).toBe(21);
    expect(resolveStagnationThresholdDays(undefined, settings(7))).toBe(7);
  });

  it("resolveStagnationThresholdDays — options が 0（オフ）なら 0 を採用する（有効値）", () => {
    // given: 0 は「機能オフ」を表す有効値でフォールバックさせない
    const config = { get: () => 0 };
    // when / then
    expect(resolveStagnationThresholdDays(config, settings(14))).toBe(0);
  });

  it("resolveStagnationThresholdDays — 不正な options 値（負・NaN・非数値）は設定既定へフォールバック", () => {
    // given: 手編集・型崩れで不正値が入っても安全側で設定既定に倒す
    expect(resolveStagnationThresholdDays({ get: () => -5 }, settings(14))).toBe(14);
    expect(resolveStagnationThresholdDays({ get: () => Number.NaN }, settings(14))).toBe(14);
    expect(resolveStagnationThresholdDays({ get: () => "30" }, settings(14))).toBe(14);
    expect(resolveStagnationThresholdDays({ get: () => null }, settings(14))).toBe(14);
  });

  it("resolveStagnationThresholdDays — 小数の options 値は floor して整数日にする", () => {
    // given: slider 等から小数が来ても日数は整数へ
    const config = { get: () => 20.7 };
    // when / then
    expect(resolveStagnationThresholdDays(config, settings(14))).toBe(20);
  });

  it("resolveStagnationThresholdDays — config.get が throw しても設定既定へ退避（churn 耐性）", () => {
    // given: Bases API の破壊的変更・内部不整合で config.get が例外を投げる
    const config = {
      get: () => {
        throw new Error("bases churn");
      },
    };
    // when / then: throw を境界で退避し、ビュー全体の再描画を壊さず設定既定で継続
    expect(resolveStagnationThresholdDays(config, settings(14))).toBe(14);
  });
});
