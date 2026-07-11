/**
 * 滞留（stagnation）判定の純ロジック（#106・v1: mtime ヒューリスティック）。
 *
 * このモジュールは Obsidian API に一切依存しない純関数だけを持つ（単体 TDD の対象）。
 * mtime の読み取り（`entry.file.stat.mtime`）・しきい値解決（ビュー options/設定）は
 * アダプタ層（`src/bases`）が担い、ここは「今日 − mtime」からの判定のみを行う（`now` 注入）。
 *
 * 判定は**読み取り専用ヒューリスティック**で、frontmatter への書き込みは一切しない
 *（v1 の「boolean のみ書く」原則を守り、分類日時のタイムスタンプ書き戻しはしない）。
 */

/** 1 日のミリ秒。経過日数の算出に使う。 */
export const MS_PER_DAY = 86_400_000;

/** 滞留判定の結果（滞留の有無と、バッジ表示に使う経過日数）。 */
export interface StagnationResult {
  /** しきい値超過で滞留とみなすか（`thresholdDays <= 0` のときは常に false＝機能オフ）。 */
  stagnant: boolean;
  /** 経過日数（`floor((now - mtime) / 1 日)`・0 以上に丸め）。バッジ表示に使う。 */
  days: number;
}

/**
 * 「今日 − mtime」から滞留の有無と経過日数を求める（純関数・`now` 注入）。
 *
 * 経過日数は日単位粒度（`floor`）で、時計ずれ・同期で mtime が未来になっても 0 未満にしない。
 * 境界は **超過のみ滞留**＝`thresholdDays > 0 && days > thresholdDays`（ちょうど N 日はセーフ・
 * N 日を超えたら滞留）。`thresholdDays <= 0` は機能オフ（常に滞留しない）。
 */
export function evaluateStagnation(
  mtime: number,
  now: number,
  thresholdDays: number,
): StagnationResult {
  const days = Math.max(0, Math.floor((now - mtime) / MS_PER_DAY));
  const stagnant = thresholdDays > 0 && days > thresholdDays;
  return { stagnant, days };
}
