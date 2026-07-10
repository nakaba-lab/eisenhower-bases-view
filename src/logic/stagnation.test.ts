import { describe, expect, it } from "vitest";
import { evaluateStagnation, type StagnationResult } from "./stagnation";

/**
 * stagnation — 「今日 − mtime」から滞留の有無と経過日数を求める純関数（#106）。
 *
 * Obsidian 非依存で `now` を注入する（単体 TDD 対象）。境界は **超過のみ滞留**＝
 * `thresholdDays > 0 && 経過日数 > thresholdDays`（ちょうど N 日はセーフ・N 日超で滞留）。
 * しきい値 0 は機能オフ（常に滞留しない）。経過日数は日単位粒度（floor）でバッジ表示に使う。
 */

const MS_PER_DAY = 86_400_000;
/** 固定の「今日」（テストの決定性のため注入する。実機はアダプタが Date.now() を渡す）。 */
const NOW = 1_700_000_000_000;
/** N 日前の mtime（ちょうど N×1日前）。 */
const daysAgo = (days: number): number => NOW - days * MS_PER_DAY;

describe("evaluateStagnation — 滞留判定（#106 AC1-3）", () => {
  it("evaluateStagnation — mtime が「今日 − N 日」より古いと滞留=true・経過日数を返す（AC1）", () => {
    // given: しきい値 14、mtime は 21 日前（14 日を超過）
    // when
    const result = evaluateStagnation(daysAgo(21), NOW, 14);
    // then: 滞留し、経過日数 21 を返す
    expect(result.stagnant).toBe(true);
    expect(result.days).toBe(21);
  });

  it("evaluateStagnation — しきい値 0 は常に滞留=false（機能オフ・AC2）", () => {
    // given / when: どれだけ古くてもしきい値 0 なら機能無効
    const result = evaluateStagnation(daysAgo(365), NOW, 0);
    // then
    expect(result.stagnant).toBe(false);
  });

  it("evaluateStagnation — 経過日数がしきい値ちょうどは滞留しない（超過のみ・AC3 境界）", () => {
    // given: しきい値 14、mtime はちょうど 14 日前（境界ちょうど＝まだセーフ）
    // when
    const result = evaluateStagnation(daysAgo(14), NOW, 14);
    // then: 境界ちょうどは滞留しない（14 > 14 は false）
    expect(result.stagnant).toBe(false);
    expect(result.days).toBe(14);
  });

  it("evaluateStagnation — しきい値を 1 日でも超えると滞留する（超過の下限・AC3 境界の裏）", () => {
    // given: しきい値 14、mtime は 15 日前（1 日超過）
    // when
    const result = evaluateStagnation(daysAgo(15), NOW, 14);
    // then
    expect(result.stagnant).toBe(true);
    expect(result.days).toBe(15);
  });

  it("evaluateStagnation — 超過未満の端数（14日+12時間）は滞留しない（日単位粒度=floor）", () => {
    // given: しきい値 14、mtime は 14.5 日前。日単位（floor）では経過 14 日＝超過未満。
    // when
    const result = evaluateStagnation(NOW - (14 * MS_PER_DAY + MS_PER_DAY / 2), NOW, 14);
    // then: floor で 14 日扱い＝滞留しない（サブ日粒度で境界がブレない）
    expect(result.days).toBe(14);
    expect(result.stagnant).toBe(false);
  });

  it("evaluateStagnation — しきい値内の新しいノートは滞留しない", () => {
    // given / when: 3 日前・しきい値 14
    const result = evaluateStagnation(daysAgo(3), NOW, 14);
    // then
    expect(result.stagnant).toBe(false);
    expect(result.days).toBe(3);
  });

  it("evaluateStagnation — mtime が未来（now より後）でも経過日数は 0 以上に丸め、滞留しない", () => {
    // given: 時計ずれ・同期で mtime が now より後になった防御ケース
    // when
    const result: StagnationResult = evaluateStagnation(NOW + 5 * MS_PER_DAY, NOW, 14);
    // then: 負の経過日数を作らず（0 以上）、滞留もしない
    expect(result.days).toBe(0);
    expect(result.stagnant).toBe(false);
  });

  it("evaluateStagnation — 負のしきい値も機能オフ扱い（0 以下は無効・防御）", () => {
    // given / when: 手編集等で負の値が入っても滞留させない
    const result = evaluateStagnation(daysAgo(100), NOW, -1);
    // then
    expect(result.stagnant).toBe(false);
  });
});
