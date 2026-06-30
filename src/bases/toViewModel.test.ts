import { describe, expect, it } from "vitest";
import type { BasesEntry, BasesPropertyId, Value } from "obsidian";
import { NullValue } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import { toViewModel } from "./toViewModel";

/**
 * toViewModel — Bases の entries を Bases 非依存の MatrixViewModel へ変換する純関数。
 * #19（F2）で各 entry の両軸値を `getValue` で読み（absent は NullValue で区別）、
 * `classifyQuadrant` で 4 象限＋未分類に**事前グルーピング**（placements）する。
 * obsidian ランタイムに依存しないよう Value/entry を構造モックする。
 */

function value(str: string, truthy: boolean): Value {
  return { toString: () => str, isTruthy: () => truthy } as unknown as Value;
}
/**
 * absent を表す **実 NullValue**（singleton）。実機の absent は NullValue で `toString()` は
 * 文字列 "null"・`isTruthy()===false`（`scripts/e2e` プローブで確定）。判定は `instanceof NullValue`。
 */
const ABSENT: Value = NullValue.value;
const TRUE = value("true", true);
const FALSE = value("false", false);

/** 両軸の値を指定した最小モック entry（軸プロパティは note.urgent / note.important）。 */
function mockEntry(
  path: string,
  basename: string,
  urgent: Value | null,
  important: Value | null,
): BasesEntry {
  const values: Record<string, Value | null> = {
    "note.urgent": urgent,
    "note.important": important,
  };
  return {
    file: { path, basename },
    getValue: (id: BasesPropertyId) => values[id] ?? null,
  } as unknown as BasesEntry;
}

describe("toViewModel — 状態とガード", () => {
  it("toViewModel — entries が 0 件なら state=empty・entries 空・placements 全空", () => {
    // given / when
    const viewModel = toViewModel([], null, DEFAULT_SETTINGS);
    // then
    expect(viewModel.state).toBe("empty");
    expect(viewModel.entries).toEqual([]);
    expect(viewModel.placements).toEqual({
      do: [],
      schedule: [],
      delegate: [],
      delete: [],
      unclassified: [],
    });
  });

  it("toViewModel — null/undefined を渡しても落ちず state=empty（防御的ガード）", () => {
    // given / when / then
    expect(toViewModel(null, null, DEFAULT_SETTINGS).state).toBe("empty");
    expect(toViewModel(undefined, null, DEFAULT_SETTINGS).state).toBe("empty");
  });
});

describe("toViewModel — 4 象限の配置（AC1-4）", () => {
  it("toViewModel — urgent=true,important=true は Do に配置", () => {
    // given
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when
    const { placements, state } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    expect(state).toBe("ready");
    expect(placements.do.map((e) => e.id)).toEqual(["a.md"]);
  });

  it("toViewModel — urgent=false,important=true は Schedule に配置", () => {
    const entries = [mockEntry("b.md", "b", FALSE, TRUE)];
    expect(
      toViewModel(entries, null, DEFAULT_SETTINGS).placements.schedule.map((e) => e.id),
    ).toEqual(["b.md"]);
  });

  it("toViewModel — urgent=true,important=false は Delegate に配置", () => {
    const entries = [mockEntry("c.md", "c", TRUE, FALSE)];
    expect(
      toViewModel(entries, null, DEFAULT_SETTINGS).placements.delegate.map((e) => e.id),
    ).toEqual(["c.md"]);
  });

  it("toViewModel — urgent=false,important=false は Delete に配置", () => {
    const entries = [mockEntry("d.md", "d", FALSE, FALSE)];
    expect(
      toViewModel(entries, null, DEFAULT_SETTINGS).placements.delete.map((e) => e.id),
    ).toEqual(["d.md"]);
  });
});

describe("toViewModel — absent / 未分類（AC5-6）", () => {
  it("toViewModel — 片方でも軸が absent なら未分類（false と区別・Delete に誤分類しない）", () => {
    // given: urgent が absent、important=false（false と混同してはならない）
    const entries = [mockEntry("x.md", "x", ABSENT, FALSE)];
    // when
    const { placements } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    expect(placements.unclassified.map((e) => e.id)).toEqual(["x.md"]);
    expect(placements.delete).toEqual([]);
  });

  it("toViewModel — 両軸 absent（軸プロパティを持たないノート・.base 自身）は未分類", () => {
    // given: getValue が両軸 null（プロパティ無し）
    const entries = [mockEntry("Config.base", "Config", null, null)];
    // when
    const { placements } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    expect(placements.unclassified.map((e) => e.id)).toEqual(["Config.base"]);
    // 4 象限のいずれにも誤配置されない
    expect(
      placements.do.concat(placements.schedule, placements.delegate, placements.delete),
    ).toEqual([]);
  });

  it("toViewModel — MatrixEntry は id/title と両軸値を持つ", () => {
    const entries = [mockEntry("Inbox/今日のタスク.md", "今日のタスク", TRUE, ABSENT)];
    const { entries: mapped } = toViewModel(entries, null, DEFAULT_SETTINGS);
    expect(mapped[0]).toEqual({
      id: "Inbox/今日のタスク.md",
      title: "今日のタスク",
      urgent: true,
      important: undefined,
    });
  });
});

describe("toViewModel — showUnclassified の反映（レビュー指摘）", () => {
  it("toViewModel — 設定 showUnclassified を ViewModel に伝える（既定 true / false 設定）", () => {
    // given
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when / then: UI が未分類ゾーンの表示可否を判断できるよう flag を載せる
    expect(toViewModel(entries, null, DEFAULT_SETTINGS).showUnclassified).toBe(true);
    expect(
      toViewModel(entries, null, { ...DEFAULT_SETTINGS, showUnclassified: false })
        .showUnclassified,
    ).toBe(false);
  });

  it("toViewModel — empty 状態でも showUnclassified を伝える", () => {
    expect(
      toViewModel([], null, { ...DEFAULT_SETTINGS, showUnclassified: false })
        .showUnclassified,
    ).toBe(false);
  });
});
