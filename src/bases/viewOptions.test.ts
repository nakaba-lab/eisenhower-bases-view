import { describe, expect, it } from "vitest";
import type { BasesPropertyId } from "obsidian";
import { buildAxisViewOptions } from "./viewOptions";
import {
  IMPORTANT_OPTION_KEY,
  URGENT_OPTION_KEY,
  isWritableAxisProperty,
} from "./readAxis";

/**
 * viewOptions — `registerBasesView` に渡す軸プロパティセレクタ options の純ビルダーと、
 * 「書き戻せる note.* 軸か」の単一述語（#21 F4）。obsidian ランタイムに依存しない純関数として
 * filter 挙動・option キー・type を単体で固定する（extends BasesView / main.ts 本体は結合で担保）。
 */

describe("isWritableAxisProperty", () => {
  it("isWritableAxisProperty — note.<key>（非空）は true＝書き戻し可能軸", () => {
    // given / when / then
    expect(isWritableAxisProperty("note.urgent" as BasesPropertyId)).toBe(true);
    expect(isWritableAxisProperty("note.due_date" as BasesPropertyId)).toBe(true);
  });

  it("isWritableAxisProperty — formula.* / file.* は false＝書き戻し不可（選択で弾く）", () => {
    // given / when / then
    expect(isWritableAxisProperty("formula.score" as BasesPropertyId)).toBe(false);
    expect(isWritableAxisProperty("file.name" as BasesPropertyId)).toBe(false);
  });

  it("isWritableAxisProperty — 空キー（bare 'note.'）は false＝空名で frontmatter を壊さない", () => {
    // given / when / then
    expect(isWritableAxisProperty("note." as BasesPropertyId)).toBe(false);
  });
});

describe("buildAxisViewOptions（AC1: note.* のみ選択肢）", () => {
  it("buildAxisViewOptions — 緊急度・重要度の 2 軸を property セレクタで返す", () => {
    // when
    const options = buildAxisViewOptions();
    // then: 2 つの property セレクタ、キーは resolveAxisPropertyIds が読むキーと一致
    expect(options).toHaveLength(2);
    const [urgent, important] = options;
    expect(urgent.key).toBe(URGENT_OPTION_KEY);
    expect(important.key).toBe(IMPORTANT_OPTION_KEY);
    expect(urgent.type).toBe("property");
    expect(important.type).toBe("property");
    expect(urgent.displayName.length).toBeGreaterThan(0);
    expect(important.displayName.length).toBeGreaterThan(0);
  });

  it("buildAxisViewOptions — 各軸の filter は note.* のみ許可し formula/file を除外（AC1）", () => {
    // given
    const options = buildAxisViewOptions();
    // when / then: filter が両軸とも書込可能 note.* 述語で弾く
    for (const option of options) {
      expect(option.filter).toBeDefined();
      const filter = option.filter!;
      expect(filter("note.due" as BasesPropertyId)).toBe(true);
      expect(filter("formula.score" as BasesPropertyId)).toBe(false);
      expect(filter("file.name" as BasesPropertyId)).toBe(false);
      expect(filter("note." as BasesPropertyId)).toBe(false);
    }
  });
});
