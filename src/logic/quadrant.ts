/**
 * Eisenhower 象限の純ロジック（v1: boolean 軸限定）。
 *
 * このモジュールは Obsidian API に一切依存しない純関数だけを持つ（単体 TDD の対象）。
 * Bases API・frontmatter 書き戻しはアダプタ層（src/bases）が担い、ここは値の判定のみを行う。
 */

/** 4 象限＋未分類。 */
export type Quadrant = "do" | "schedule" | "delegate" | "delete" | "unclassified";

/**
 * 1 ノートの両軸値。`undefined` は「プロパティが存在しない（absent）」を表し、
 * 明示的な `false` とは区別する（absent と false を区別する＝要件定義書の盲点対策）。
 */
export interface AxisValues {
  urgent: boolean | undefined;
  important: boolean | undefined;
}

/**
 * 緊急度・重要度の boolean 値から象限を決定する。
 * 片方でも軸値が absent（undefined）なら "unclassified"。
 */
export function classifyQuadrant(values: AxisValues): Quadrant {
  const { urgent, important } = values;
  if (urgent === undefined || important === undefined) {
    return "unclassified";
  }
  if (important && urgent) return "do";
  if (important && !urgent) return "schedule";
  if (!important && urgent) return "delegate";
  return "delete";
}

/**
 * 象限から、書き戻すべき両軸の boolean 値を求める（ドラッグ時の frontmatter 書き戻し用）。
 * "unclassified" はドロップ先にできないため書き戻し不可（null を返す）。
 */
export function axisValuesForQuadrant(
  quadrant: Quadrant,
): { urgent: boolean; important: boolean } | null {
  switch (quadrant) {
    case "do":
      return { urgent: true, important: true };
    case "schedule":
      return { urgent: false, important: true };
    case "delegate":
      return { urgent: true, important: false };
    case "delete":
      return { urgent: false, important: false };
    case "unclassified":
      return null;
  }
}
