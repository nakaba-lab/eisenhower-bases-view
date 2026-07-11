import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import {
  STAGNATION_OPTION_KEY,
  parseThresholdInput,
  resolveStagnationThresholdDays,
  toThresholdDays,
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

  it("resolveStagnationThresholdDays — config.get が繰り返し throw してもログは間引かれる（再描画毎の spam 防止・レビュー指摘）", () => {
    // given: churn した config.get が呼ぶたび throw（再描画毎に走る想定）
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const config = {
      get: () => {
        throw new Error("bases churn");
      },
    };
    // when: 同一キーで複数回解決する
    resolveStagnationThresholdDays(config, settings(14));
    resolveStagnationThresholdDays(config, settings(14));
    resolveStagnationThresholdDays(config, settings(14));
    // then: 兄弟ラッパー（safeGetAsPropertyId）と対称にキー単位で 1 回へ間引く（毎回ログしない）。
    // モジュールレベル Set の共有で先行テストが既にログ済みなら 0、未ログなら 1＝いずれも「3 回未満」。
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    spy.mockRestore();
  });
});

describe("toThresholdDays — 生値の正規化（options 解決と設定読込で共有・レビュー指摘 #9）", () => {
  it("有限・0 以上の数値はそのまま（小数は floor）", () => {
    expect(toThresholdDays(14)).toBe(14);
    expect(toThresholdDays(0)).toBe(0); // 0 はオフの有効値（?? で潰れない前提）
    expect(toThresholdDays(20.7)).toBe(20);
  });

  it("不正値（負・NaN・非数値・null）は null（呼び出し側が既定へ倒す）", () => {
    expect(toThresholdDays(-1)).toBeNull();
    expect(toThresholdDays(Number.NaN)).toBeNull();
    expect(toThresholdDays("30")).toBeNull();
    expect(toThresholdDays(null)).toBeNull();
    expect(toThresholdDays(undefined)).toBeNull();
  });
});

describe("parseThresholdInput — 設定タブ入力の解釈（#106・レビュー指摘 #4）", () => {
  it("空欄は null（＝現在値を保持・無効化でも既定復帰でもない）", () => {
    // given/when/then: 空・空白のみは「入力途中」＝保存しない（カスタム値を黙って 14 に上書きしない）
    expect(parseThresholdInput("")).toBeNull();
    expect(parseThresholdInput("   ")).toBeNull();
  });

  it("非数値・負値は null（現在値を保持）", () => {
    expect(parseThresholdInput("abc")).toBeNull();
    expect(parseThresholdInput("-5")).toBeNull();
  });

  it("0 は 0（機能オフの明示入力）", () => {
    expect(parseThresholdInput("0")).toBe(0);
  });

  it("有効な非負整数はその値（前後空白は許容）", () => {
    expect(parseThresholdInput("30")).toBe(30);
    expect(parseThresholdInput("  21 ")).toBe(21);
  });
});
