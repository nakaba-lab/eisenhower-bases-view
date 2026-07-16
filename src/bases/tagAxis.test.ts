import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import {
  IMPORTANT_TAG_OPTION_KEY,
  URGENT_TAG_OPTION_KEY,
  resolveTagNames,
  toTagName,
} from "./tagAxis";

/**
 * tagAxis — タグ軸の tagName 解決（#125 v0.3-3b）。数値しきい値（`numberThreshold`）と同じ
 * per-axis ハイブリッド（ビュー options 主・設定既定フォールバック）。空文字/未設定は `null`
 *（当該軸はタグ軸オフ）。`#` 前置は bare 形へ正規化する（`interpretAxis`／書き戻しが bare で扱うため）。
 */

function configWith(values: Record<string, unknown>): { get(key: string): unknown } {
  return { get: (key: string) => values[key] };
}

describe("toTagName — 生値を bare tagName へ正規化", () => {
  it("toTagName — 通常の文字列はそのまま bare 名", () => {
    expect(toTagName("urgent")).toBe("urgent");
  });

  it("toTagName — 先頭の # を剥がして bare 名にする（Value 層は #urgent・frontmatter は bare）", () => {
    expect(toTagName("#urgent")).toBe("urgent");
  });

  it("toTagName — 前後空白をトリムする", () => {
    expect(toTagName("  urgent  ")).toBe("urgent");
    expect(toTagName(" #urgent ")).toBe("urgent");
  });

  it("toTagName — 空文字・空白のみ・# のみは null（タグ軸オフ）", () => {
    expect(toTagName("")).toBeNull();
    expect(toTagName("   ")).toBeNull();
    expect(toTagName("#")).toBeNull();
  });

  it("toTagName — 非文字列（null/undefined/数値）は null", () => {
    expect(toTagName(null)).toBeNull();
    expect(toTagName(undefined)).toBeNull();
    expect(toTagName(3)).toBeNull();
  });
});

describe("resolveTagNames — ビュー options 主・設定既定フォールバック", () => {
  it("resolveTagNames — 既定設定（tag 未設定）は両軸 null（タグ軸オフ）", () => {
    expect(resolveTagNames(null, DEFAULT_SETTINGS)).toEqual({
      urgent: null,
      important: null,
    });
  });

  it("resolveTagNames — ビュー options のタグ名を主に採る（# 前置も正規化）", () => {
    const config = configWith({
      [URGENT_TAG_OPTION_KEY]: "#urgent",
      [IMPORTANT_TAG_OPTION_KEY]: "important",
    });
    expect(resolveTagNames(config, DEFAULT_SETTINGS)).toEqual({
      urgent: "urgent",
      important: "important",
    });
  });

  it("resolveTagNames — options 未設定なら設定既定へフォールバックする", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      defaultUrgencyTag: "urgent",
      defaultImportanceTag: "important",
    };
    expect(resolveTagNames(null, settings)).toEqual({
      urgent: "urgent",
      important: "important",
    });
  });

  it("resolveTagNames — options が空文字なら設定既定へフォールバック（空は未設定扱い）", () => {
    const config = configWith({ [URGENT_TAG_OPTION_KEY]: "  " });
    const settings = { ...DEFAULT_SETTINGS, defaultUrgencyTag: "urgent" };
    expect(resolveTagNames(config, settings).urgent).toBe("urgent");
  });

  it("resolveTagNames — config.get が throw しても設定既定へ倒す（churn 耐性）", () => {
    const config = {
      get: () => {
        throw new Error("churn");
      },
    };
    const settings = { ...DEFAULT_SETTINGS, defaultImportanceTag: "important" };
    expect(resolveTagNames(config, settings).important).toBe("important");
  });
});
