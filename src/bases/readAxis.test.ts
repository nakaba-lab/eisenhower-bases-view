import { describe, expect, it } from "vitest";
import type { BasesEntry, BasesPropertyId, BasesViewConfig, Value } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import {
  IMPORTANT_OPTION_KEY,
  URGENT_OPTION_KEY,
  readAxisValues,
  resolveAxisPropertyIds,
  type AxisPropertyIds,
} from "./readAxis";

/**
 * readAxis — 軸プロパティの解決（config 主・settings デフォルト）と、
 * 1 軸値の absent/true/false 正規化（スパイク #16 確定の NullValue 判定）。
 * obsidian ランタイムに依存しないよう Value/Config を構造モックする。
 */

/** toString()/isTruthy() だけを持つ最小の Value モック。 */
function value(str: string | null, truthy: boolean): Value {
  return { toString: () => str, isTruthy: () => truthy } as unknown as Value;
}
/** absent を表す NullValue（toString()===null・isTruthy()===false）。 */
const ABSENT = value(null, false);
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

  it("readAxisValues — absent(NullValue: toString()===null) は undefined（false と区別）", () => {
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
});
