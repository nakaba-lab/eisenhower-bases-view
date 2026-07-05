import { describe, expect, it, vi } from "vitest";
import {
  VIEW_ID,
  VIEW_NAME,
  safeRegisterBasesView,
} from "./registerView";

/**
 * safeRegisterBasesView — registerBasesView 呼び出しを graceful に包む純ラッパ。
 * Bases 無効（false 返却）や API 例外でもプラグインを壊さず false を返す（AC2）。
 * obsidian ランタイムに依存しないよう register をコールバックで注入してテストする。
 */

describe("safeRegisterBasesView", () => {
  it("safeRegisterBasesView — register が true を返すと true（登録成功）", () => {
    // given
    const register = vi.fn(() => true);
    // when
    const ok = safeRegisterBasesView(register);
    // then
    expect(ok).toBe(true);
    expect(register).toHaveBeenCalledOnce();
  });

  it("safeRegisterBasesView — register が false（Bases 無効）でも投げず false・onUnavailable 呼ぶ", () => {
    // given
    const register = vi.fn(() => false);
    const onUnavailable = vi.fn();
    // when
    const ok = safeRegisterBasesView(register, onUnavailable);
    // then
    expect(ok).toBe(false);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it("safeRegisterBasesView — register が例外を投げても伝播させず false（graceful）", () => {
    // given
    const register = vi.fn(() => {
      throw new Error("Bases API unavailable");
    });
    const onUnavailable = vi.fn();
    // when / then
    expect(() => safeRegisterBasesView(register, onUnavailable)).not.toThrow();
    expect(safeRegisterBasesView(register, onUnavailable)).toBe(false);
    expect(onUnavailable).toHaveBeenCalled();
  });

  it("VIEW_ID / VIEW_NAME — 公開後変更不可の安定 ID と表示名を持つ", () => {
    expect(VIEW_ID).toBe("eisenhower-matrix");
    expect(VIEW_NAME).toBe("Eisenhower Matrix");
  });
});
