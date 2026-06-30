import { describe, expect, it } from "vitest";
import type { BasesEntry } from "obsidian";
import { toViewModel } from "./toViewModel";

/**
 * toViewModel — Bases の entries を Bases 非依存の MatrixViewModel へ変換する純関数。
 * F1（#18）では state（empty/ready）と各 entry の id/title までを組む
 *（軸値・象限配置は #19 で追加）。obsidian ランタイムに依存しないよう
 * 構造的なモック entry を渡してテストする。
 */

/** file.path / file.basename だけを持つ最小モック entry。 */
function mockEntry(path: string, basename: string): BasesEntry {
  return { file: { path, basename } } as unknown as BasesEntry;
}

describe("toViewModel", () => {
  it("toViewModel — entries が 0 件なら state=empty・entries 空", () => {
    // given
    const entries: BasesEntry[] = [];
    // when
    const viewModel = toViewModel(entries);
    // then
    expect(viewModel.state).toBe("empty");
    expect(viewModel.entries).toEqual([]);
  });

  it("toViewModel — null/undefined を渡しても落ちず state=empty（防御的ガード）", () => {
    // given / when / then
    expect(toViewModel(null).state).toBe("empty");
    expect(toViewModel(undefined).state).toBe("empty");
    expect(toViewModel(null).entries).toEqual([]);
    expect(toViewModel(undefined).entries).toEqual([]);
  });

  it("toViewModel — entries があれば state=ready で id/title にマップする", () => {
    // given
    const entries = [
      mockEntry("Tasks/a.md", "a"),
      mockEntry("Tasks/b.md", "b"),
    ];
    // when
    const viewModel = toViewModel(entries);
    // then
    expect(viewModel.state).toBe("ready");
    expect(viewModel.entries).toEqual([
      { id: "Tasks/a.md", title: "a" },
      { id: "Tasks/b.md", title: "b" },
    ]);
  });

  it("toViewModel — id は file.path、title は file.basename を使う", () => {
    // given
    const entries = [mockEntry("Inbox/今日のタスク.md", "今日のタスク")];
    // when
    const viewModel = toViewModel(entries);
    // then
    expect(viewModel.entries[0]).toEqual({
      id: "Inbox/今日のタスク.md",
      title: "今日のタスク",
    });
  });
});
