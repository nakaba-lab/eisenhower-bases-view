import { describe, expect, it } from "vitest";
import type { BasesEntry, BasesPropertyId, BasesViewConfig, Value } from "obsidian";
import { NullValue } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import {
  IMPORTANT_OPTION_KEY,
  URGENT_OPTION_KEY,
  readAxisValues,
  resolveAxisPropertyIds,
  toFrontmatterKey,
  type AxisPropertyIds,
} from "./readAxis";

/**
 * readAxis — 軸プロパティの解決（config 主・settings デフォルト）と、
 * 1 軸値の absent/true/false 正規化（スパイク #16 確定の NullValue 判定）。
 * obsidian ランタイムに依存しないよう Value/Config を構造モックする。
 */

/** toString()/isTruthy() だけを持つ最小の Value モック（true/false 用）。 */
function value(str: string, truthy: boolean): Value {
  return { toString: () => str, isTruthy: () => truthy } as unknown as Value;
}
/**
 * absent を表す **実 NullValue**（singleton）。実機の absent は NullValue で、
 * `toString()` は**文字列 "null"**・`isTruthy()===false`（`scripts/e2e` のプローブで確定）。
 * 判定は `toString()` の文字列ではなく `instanceof NullValue`（型同一性）で行うため、
 * 旧モック（`toString()===null` を返す素オブジェクト）ではなく実 NullValue を使う。
 */
const ABSENT: Value = NullValue.value;
const TRUE = value("true", true);
const FALSE = value("false", false);

function mockEntry(values: Record<string, Value | null>): BasesEntry {
  return {
    file: { path: "Tasks/a.md", basename: "a" },
    getValue: (id: BasesPropertyId) => values[id] ?? null,
  } as unknown as BasesEntry;
}

function mockConfig(
  map: Record<string, BasesPropertyId | null>,
): Pick<BasesViewConfig, "getAsPropertyId"> {
  return { getAsPropertyId: (key: string) => map[key] ?? null };
}

describe("resolveAxisPropertyIds", () => {
  it("resolveAxisPropertyIds — config 未設定なら settings デフォルトを note.<name> で使う", () => {
    // given / when
    const ids = resolveAxisPropertyIds(null, DEFAULT_SETTINGS);
    // then
    expect(ids).toEqual({
      urgent: "note.urgent",
      important: "note.important",
    });
  });

  it("resolveAxisPropertyIds — config のビュー options を主に使う（settings より優先）", () => {
    // given
    const config = mockConfig({
      [URGENT_OPTION_KEY]: "note.due" as BasesPropertyId,
      [IMPORTANT_OPTION_KEY]: "note.priority" as BasesPropertyId,
    });
    // when
    const ids = resolveAxisPropertyIds(config, DEFAULT_SETTINGS);
    // then
    expect(ids).toEqual({ urgent: "note.due", important: "note.priority" });
  });

  it("resolveAxisPropertyIds — 片方だけ config 設定なら他方は settings デフォルト", () => {
    // given
    const config = mockConfig({
      [URGENT_OPTION_KEY]: "note.due" as BasesPropertyId,
      [IMPORTANT_OPTION_KEY]: null,
    });
    // when
    const ids = resolveAxisPropertyIds(config, DEFAULT_SETTINGS);
    // then
    expect(ids).toEqual({ urgent: "note.due", important: "note.important" });
  });
});

describe("readAxisValues", () => {
  const ids: AxisPropertyIds = {
    urgent: "note.urgent" as BasesPropertyId,
    important: "note.important" as BasesPropertyId,
  };

  it("readAxisValues — true/false をそのまま boolean に正規化する", () => {
    // given
    const entry = mockEntry({ "note.urgent": TRUE, "note.important": FALSE });
    // when
    const axis = readAxisValues(entry, ids);
    // then
    expect(axis).toEqual({ urgent: true, important: false });
  });

  it("readAxisValues — absent(NullValue・instanceof で判定) は undefined（false と区別）", () => {
    // given
    const entry = mockEntry({ "note.urgent": ABSENT, "note.important": FALSE });
    // when
    const axis = readAxisValues(entry, ids);
    // then
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(false);
  });

  it("readAxisValues — getValue が null を返す欠損も undefined（防御）", () => {
    // given
    const entry = mockEntry({ "note.urgent": null, "note.important": TRUE });
    // when
    const axis = readAxisValues(entry, ids);
    // then
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(true);
  });

  it("readAxisValues — note.* 以外（formula/file）の軸は値があっても undefined＝未分類化（読み書き対称・レビュー指摘）", () => {
    // given: 緊急軸を書き戻し不可な formula.* に、重要軸を note.* に設定
    const mixedIds: AxisPropertyIds = {
      urgent: "formula.score" as BasesPropertyId,
      important: "note.important" as BasesPropertyId,
    };
    const entry = mockEntry({ "formula.score": TRUE, "note.important": TRUE });
    // when
    const axis = readAxisValues(entry, mixedIds);
    // then: formula 軸は getValue が真値でも absent 扱い → 4 象限に並べず未分類（ドラッグ→必ず失敗を防ぐ）
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(true);
  });
});

describe("toFrontmatterKey", () => {
  it("toFrontmatterKey — note.<key> から frontmatter キーを取り出す（書き戻し用・#20）", () => {
    // given / when / then
    expect(toFrontmatterKey("note.urgent" as BasesPropertyId)).toBe("urgent");
    expect(toFrontmatterKey("note.due_date" as BasesPropertyId)).toBe("due_date");
  });

  it("toFrontmatterKey — note. 接頭辞でない（formula./file.）は null＝書き戻し不可", () => {
    // given / when / then
    expect(toFrontmatterKey("formula.score" as BasesPropertyId)).toBeNull();
    expect(toFrontmatterKey("file.name" as BasesPropertyId)).toBeNull();
  });

  it("toFrontmatterKey — 空キー（bare 'note.'）は null＝空名で frontmatter を壊さない（レビュー指摘）", () => {
    // given / when / then: note. の後ろが空なら書き戻しキーにできない
    expect(toFrontmatterKey("note." as BasesPropertyId)).toBeNull();
  });
});
