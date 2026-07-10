import { describe, expect, it } from "vitest";
import type { BasesPropertyId } from "obsidian";
import { buildAxisViewOptions, buildBadgeViewOptions } from "./viewOptions";
import { messagesFor } from "../i18n";
import {
  IMPORTANT_OPTION_KEY,
  URGENT_OPTION_KEY,
  isWritableAxisProperty,
} from "./readAxis";
import { BADGE_OPTION_KEYS, MAX_BADGE_PROPERTIES } from "./readBadges";

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

  it("isWritableAxisProperty — frontmatter プロパティ名が 'note.x'（propertyId=note.note.x）は true＝入れ子を意図的に許可", () => {
    // given / when / then: note 名前空間の非空キーなので書き戻し可能（弾き忘れではない）
    expect(isWritableAxisProperty("note.note.x" as BasesPropertyId)).toBe(true);
  });

  it("isWritableAxisProperty — null / undefined / 非文字列は false を返し、クラッシュしない（Bases 境界の防御）", () => {
    // given / when / then: 予期しない値でも startsWith で throw せず false
    expect(isWritableAxisProperty(null as unknown as BasesPropertyId)).toBe(false);
    expect(isWritableAxisProperty(undefined as unknown as BasesPropertyId)).toBe(false);
    expect(isWritableAxisProperty(123 as unknown as BasesPropertyId)).toBe(false);
  });
});

describe("buildAxisViewOptions（AC1: note.* のみ選択肢）", () => {
  it("buildAxisViewOptions — 緊急度・重要度の 2 軸を property セレクタで返す", () => {
    // when
    const options = buildAxisViewOptions(messagesFor("ja"));
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

  it("buildAxisViewOptions — displayName は渡した言語メッセージに追従する（#23 F6 i18n）", () => {
    // given / when: 英語・日本語それぞれで組む
    const [enUrgent, enImportant] = buildAxisViewOptions(messagesFor("en"));
    const [jaUrgent, jaImportant] = buildAxisViewOptions(messagesFor("ja"));
    // then: displayName が言語別（en は英語・ja は日本語）で、messages.axisOption を反映する
    expect(enUrgent.displayName).toBe("Urgency axis property");
    expect(enImportant.displayName).toBe("Importance axis property");
    expect(jaUrgent.displayName).toBe("緊急度軸プロパティ");
    expect(jaImportant.displayName).toBe("重要度軸プロパティ");
  });

  it("buildAxisViewOptions — 各軸の filter は note.* のみ許可し formula/file を除外（AC1）", () => {
    // given
    const options = buildAxisViewOptions(messagesFor("ja"));
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

describe("buildBadgeViewOptions（#104 F7: カード表示プロパティ・読み取り専用）", () => {
  it("buildBadgeViewOptions — 既定で最大 3 個の property セレクタを返す（badgeProperty1..3）", () => {
    // when
    const options = buildBadgeViewOptions(messagesFor("ja"));
    // then: MAX_BADGE_PROPERTIES 個、キーは resolveBadgePropertyIds が読むキーと一致
    expect(options).toHaveLength(MAX_BADGE_PROPERTIES);
    options.forEach((option, index) => {
      expect(option.key).toBe(BADGE_OPTION_KEYS[index]);
      expect(option.type).toBe("property");
      expect(option.displayName.length).toBeGreaterThan(0);
    });
  });

  it("buildBadgeViewOptions — count を渡すと個数を絞れる（最大 3 でクランプ）", () => {
    expect(buildBadgeViewOptions(messagesFor("ja"), 2)).toHaveLength(2);
    // MAX を超える指定は MAX に丸める
    expect(buildBadgeViewOptions(messagesFor("ja"), 5)).toHaveLength(MAX_BADGE_PROPERTIES);
  });

  it("buildBadgeViewOptions — filter は全プロパティを許可する（軸と違い formula.*/file.* も選べる読み取り専用）", () => {
    // given
    const options = buildBadgeViewOptions(messagesFor("ja"));
    // when / then: 読み取り専用サーフェスなので note.* に限定せず何でも通す
    for (const option of options) {
      expect(option.filter).toBeDefined();
      const filter = option.filter!;
      expect(filter("note.due" as BasesPropertyId)).toBe(true);
      expect(filter("formula.score" as BasesPropertyId)).toBe(true);
      expect(filter("file.mtime" as BasesPropertyId)).toBe(true);
    }
  });

  it("buildBadgeViewOptions — displayName は渡した言語メッセージに追従する（en/ja で異なる）", () => {
    const [enFirst] = buildBadgeViewOptions(messagesFor("en"));
    const [jaFirst] = buildBadgeViewOptions(messagesFor("ja"));
    expect(enFirst.displayName).not.toBe(jaFirst.displayName);
  });
});
