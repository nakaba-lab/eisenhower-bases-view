import { describe, expect, it } from "vitest";
import { isEmphasizedDate } from "./dateEmphasis";

/**
 * dateEmphasis — 「厳格 ISO 日付（YYYY-MM-DD）が今日以前か」を判定する純ロジック（#104 F8・AC4）。
 *
 * カード追加プロパティ表示（バッジ）の日付強調トグルが on のとき、期日らしい値を強調するかを決める。
 * `today` は ISO 文字列で注入する（`Date.now()` 非依存＝単体テスト可能）。**厳格 ISO 判定に限定**し、
 * Bases の filter/formula の再実装には踏み込まない（将来これを条件付き書式 DSL に育てない＝設計の線引き）。
 */

describe("isEmphasizedDate — 厳格 ISO かつ今日以前（AC4）", () => {
  const TODAY = "2026-07-09";

  it("isEmphasizedDate — 今日より前の厳格 ISO 日付は true（強調対象）", () => {
    // given / when / then
    expect(isEmphasizedDate("2026-07-01", TODAY)).toBe(true);
    expect(isEmphasizedDate("2025-12-31", TODAY)).toBe(true);
  });

  it("isEmphasizedDate — 今日ちょうどの厳格 ISO 日付は true（『今日以前』は今日を含む）", () => {
    expect(isEmphasizedDate(TODAY, TODAY)).toBe(true);
  });

  it("isEmphasizedDate — 未来の厳格 ISO 日付は false（強調しない）", () => {
    expect(isEmphasizedDate("2026-07-10", TODAY)).toBe(false);
    expect(isEmphasizedDate("2027-01-01", TODAY)).toBe(false);
  });

  it("isEmphasizedDate — 厳格 ISO でない形式は日付でも false（線引き＝緩いパースをしない）", () => {
    // given / when / then: ゼロ埋めなし・時刻付き・スラッシュ区切りは対象外
    expect(isEmphasizedDate("2026-7-1", TODAY)).toBe(false);
    expect(isEmphasizedDate("2026-07-01T10:00", TODAY)).toBe(false);
    expect(isEmphasizedDate("2026-07-01 10:00", TODAY)).toBe(false);
    expect(isEmphasizedDate("2026/07/01", TODAY)).toBe(false);
    expect(isEmphasizedDate("07-01-2026", TODAY)).toBe(false);
  });

  it("isEmphasizedDate — 暦として不正な日付は false（厳格＝実在日のみ）", () => {
    expect(isEmphasizedDate("2026-13-01", TODAY)).toBe(false); // 13 月
    expect(isEmphasizedDate("2026-02-30", TODAY)).toBe(false); // 2 月 30 日
    expect(isEmphasizedDate("2026-00-10", TODAY)).toBe(false); // 0 月
  });

  it("isEmphasizedDate — 日付でない文字列・空文字は false（例外・absent 由来の空表示も安全側）", () => {
    expect(isEmphasizedDate("仕事", TODAY)).toBe(false);
    expect(isEmphasizedDate("", TODAY)).toBe(false);
    expect(isEmphasizedDate("true", TODAY)).toBe(false);
  });

  it("isEmphasizedDate — today が空/不正なら常に false（強調を安全側で無効化）", () => {
    // given / when / then: today が渡らない/壊れているとき、過去日でも強調しない
    expect(isEmphasizedDate("2026-07-01", "")).toBe(false);
    expect(isEmphasizedDate("2026-07-01", "not-a-date")).toBe(false);
  });
});
