import { describe, expect, it } from "vitest";
import type { BasesEntry, BasesPropertyId, Value } from "obsidian";
import { BooleanValue, NullValue, NumberValue, StringValue } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import {
  BADGE_OPTION_KEYS,
  MAX_BADGE_PROPERTIES,
  badgeLabel,
  readBadges,
  resolveBadgePropertyIds,
} from "./readBadges";

/**
 * readBadges — カード追加プロパティ表示（バッジ）の解決・読み取り・正規化（#104 F8・読み取り専用）。
 *
 * 軸（書き戻し `note.*` 限定）と違い**別サーフェス（読み取り専用）**のため `formula.*`／`file.*` も可。
 * `entry.getValue` の Value を表示文字列へ正規化し、例外・absent は空文字へ退避してビュー全体を壊さない
 * （`readAxisValueSafely` と同型の境界防御）。obsidian の値 import はスタブへ解決される。
 */

/** 指定プロパティ ID→Value の最小モック entry。 */
function mockEntry(values: Record<string, Value | null>): BasesEntry {
  return {
    getValue: (id: BasesPropertyId) => values[id] ?? null,
  } as unknown as BasesEntry;
}

/** getValue が必ず throw する entry（Bases 境界の例外を模す）。 */
function throwingEntry(): BasesEntry {
  return {
    getValue: () => {
      throw new Error("Bases getValue boom");
    },
  } as unknown as BasesEntry;
}

/** ビュー options（config.getAsPropertyId）のモック。 */
function mockConfig(
  map: Record<string, BasesPropertyId | null>,
): { getAsPropertyId: (key: string) => BasesPropertyId | null } {
  return { getAsPropertyId: (key: string) => map[key] ?? null };
}

const READ_OPTS = { today: "2026-07-09", emphasizePastDates: false };

describe("badgeLabel — propertyId から表示ラベルを導く", () => {
  it("badgeLabel — note./file./formula. の名前空間接頭辞を落とす（読み取り専用＝全サーフェス可）", () => {
    expect(badgeLabel("note.due" as BasesPropertyId)).toBe("due");
    expect(badgeLabel("file.mtime" as BasesPropertyId)).toBe("mtime");
    expect(badgeLabel("formula.score" as BasesPropertyId)).toBe("score");
  });

  it("badgeLabel — 名前空間の無い/未知の id はそのまま返す（防御）", () => {
    expect(badgeLabel("due" as BasesPropertyId)).toBe("due");
    expect(badgeLabel("" as BasesPropertyId)).toBe("");
  });
});

describe("resolveBadgePropertyIds — ビュー options 主・設定デフォルト", () => {
  it("resolveBadgePropertyIds — 既定（設定 cardBadgeProperties=[]・options 無し）は空配列＝表示 0 個（AC3）", () => {
    // given / when / then: 既定は表示 0 個でカード密度は現状維持
    expect(resolveBadgePropertyIds(null, DEFAULT_SETTINGS)).toEqual([]);
  });

  it("resolveBadgePropertyIds — ビュー options（badgeProperty1..N）を順に解決する（読み取り専用＝formula/file も可）", () => {
    // given: options で 2 スロットに note.due / formula.score を設定
    const config = mockConfig({
      badgeProperty1: "note.due" as BasesPropertyId,
      badgeProperty2: "formula.score" as BasesPropertyId,
    });
    // when
    const ids = resolveBadgePropertyIds(config, DEFAULT_SETTINGS);
    // then: 設定順に 2 件（formula も弾かれない＝軸の note.* 制約とは別サーフェス）
    expect(ids).toEqual(["note.due", "formula.score"]);
  });

  it("resolveBadgePropertyIds — options 未設定なら設定 cardBadgeProperties をデフォルトに使う", () => {
    // given: options 無し・設定に file.mtime / note.tags
    const settings = {
      ...DEFAULT_SETTINGS,
      cardBadgeProperties: ["file.mtime", "note.tags"],
    };
    // when / then
    expect(resolveBadgePropertyIds(null, settings)).toEqual(["file.mtime", "note.tags"]);
  });

  it("resolveBadgePropertyIds — options が 1 つでもあれば options を優先（設定デフォルトは使わない）", () => {
    const config = mockConfig({ badgeProperty1: "note.project" as BasesPropertyId });
    const settings = { ...DEFAULT_SETTINGS, cardBadgeProperties: ["file.mtime"] };
    expect(resolveBadgePropertyIds(config, settings)).toEqual(["note.project"]);
  });

  it("resolveBadgePropertyIds — 最大 3 個までに丸める（MAX_BADGE_PROPERTIES）", () => {
    // given: 設定に 4 個並べても 3 個までに制限
    const settings = {
      ...DEFAULT_SETTINGS,
      cardBadgeProperties: ["note.a", "note.b", "note.c", "note.d"],
    };
    // when / then
    expect(resolveBadgePropertyIds(null, settings)).toHaveLength(MAX_BADGE_PROPERTIES);
    expect(resolveBadgePropertyIds(null, settings)).toEqual(["note.a", "note.b", "note.c"]);
  });

  it("resolveBadgePropertyIds — getAsPropertyId が throw しても落ちず既定/空へ倒す（Bases 境界防御）", () => {
    const throwingConfig = {
      getAsPropertyId: () => {
        throw new Error("boom");
      },
    };
    // then: 例外は握って設定デフォルト（既定 []）へフォールバック
    expect(resolveBadgePropertyIds(throwingConfig, DEFAULT_SETTINGS)).toEqual([]);
  });

  it("BADGE_OPTION_KEYS — 解決キーは最大数ぶんの badgeProperty1..N で MAX と一致する", () => {
    expect(BADGE_OPTION_KEYS).toHaveLength(MAX_BADGE_PROPERTIES);
    expect(BADGE_OPTION_KEYS[0]).toBe("badgeProperty1");
  });
});

describe("readBadges — Value→表示文字列の正規化と境界防御（AC1/AC2）", () => {
  it("readBadges — 2 個設定で解決済み {label,text} が 2 件載る（AC1）", () => {
    // given: note.due（文字列日付）と note.project（文字列）
    const entry = mockEntry({
      "note.due": new StringValue("2026-07-01"),
      "note.project": new StringValue("仕事"),
    });
    const ids = ["note.due", "note.project"] as BasesPropertyId[];
    // when
    const badges = readBadges(entry, ids, READ_OPTS);
    // then: プロパティ順に 2 件、label は接頭辞を落とした名・text は正規化済み
    expect(badges).toHaveLength(2);
    expect(badges[0]).toMatchObject({ label: "due", text: "2026-07-01" });
    expect(badges[1]).toMatchObject({ label: "project", text: "仕事" });
  });

  it("readBadges — 数値/真偽値も toString ベースで正規化する（型別分岐は最小限・churn 耐性）", () => {
    const entry = mockEntry({
      "note.count": new NumberValue(3),
      "note.done": new BooleanValue(true),
    });
    const ids = ["note.count", "note.done"] as BasesPropertyId[];
    const badges = readBadges(entry, ids, READ_OPTS);
    expect(badges[0].text).toBe("3");
    expect(badges[1].text).toBe("true");
  });

  it("readBadges — absent（NullValue）の値は空表示へ退避（badge は残る・AC2）", () => {
    // given: note.due は absent（欠損）
    const entry = mockEntry({ "note.due": NullValue.value });
    const ids = ["note.due"] as BasesPropertyId[];
    // when
    const badges = readBadges(entry, ids, READ_OPTS);
    // then: バッジ自体は残り（AC1 の件数を保つ）、text は空（NullValue.toString()="null" を出さない）
    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({ label: "due", text: "" });
  });

  it("readBadges — getValue が throw した軸は空表示へ退避しビュー全体は壊れない（AC2）", () => {
    // given: getValue が必ず throw する entry
    const ids = ["note.due", "note.project"] as BasesPropertyId[];
    // when
    const badges = readBadges(throwingEntry(), ids, READ_OPTS);
    // then: 例外を境界で握り、各バッジは空表示（件数は保つ）
    expect(badges).toHaveLength(2);
    expect(badges.every((b) => b.text === "")).toBe(true);
  });

  it("readBadges — Value.toString() が throw しても空表示へ退避（境界防御を getValue の外＝正規化まで及ぼす・AC2）", () => {
    // given: getValue は成功するが toString() が throw する Value（churn した Bases の未知型を模す）
    const badValue = {
      toString() {
        throw new Error("toString boom");
      },
      isTruthy() {
        return false;
      },
    } as unknown as Value;
    const entry = mockEntry({ "note.x": badValue });
    // when / then: 正規化（toString）まで境界で握り、ビューを壊さず空表示にする
    const badges = readBadges(entry, ["note.x"] as BasesPropertyId[], READ_OPTS);
    expect(badges).toHaveLength(1);
    expect(badges[0].text).toBe("");
  });

  it("readBadges — ids が空なら空配列（表示 0 個・AC3）", () => {
    expect(readBadges(mockEntry({}), [], READ_OPTS)).toEqual([]);
  });
});

describe("readBadges — 日付強調フラグ（AC4）", () => {
  const ids = ["note.due"] as BasesPropertyId[];

  it("readBadges — 厳格 ISO 日付が今日以前 × 強調 on なら emphasized=true", () => {
    // given: note.due=2026-07-01（今日 2026-07-09 より前）・強調トグル on
    const entry = mockEntry({ "note.due": new StringValue("2026-07-01") });
    // when
    const badges = readBadges(entry, ids, { today: "2026-07-09", emphasizePastDates: true });
    // then
    expect(badges[0].emphasized).toBe(true);
  });

  it("readBadges — 強調トグル off なら過去日でも emphasized は付かない（既定オフ）", () => {
    const entry = mockEntry({ "note.due": new StringValue("2026-07-01") });
    const badges = readBadges(entry, ids, { today: "2026-07-09", emphasizePastDates: false });
    expect(badges[0].emphasized).toBeFalsy();
  });

  it("readBadges — 未来日は強調 on でも emphasized が付かない", () => {
    const entry = mockEntry({ "note.due": new StringValue("2026-07-10") });
    const badges = readBadges(entry, ids, { today: "2026-07-09", emphasizePastDates: true });
    expect(badges[0].emphasized).toBeFalsy();
  });

  it("readBadges — 日付でない値は強調 on でも emphasized が付かない", () => {
    const entry = mockEntry({ "note.due": new StringValue("仕事") });
    const badges = readBadges(entry, ids, { today: "2026-07-09", emphasizePastDates: true });
    expect(badges[0].emphasized).toBeFalsy();
  });
});
