import type { MatrixEntry } from "../bases/types";

/**
 * 1 つの象限（または未分類ゾーン）のセル。カードのドロップ先になる領域（DnD は #20）。
 *
 * #19（F2）: 象限ラベル・軸ラベル（緊急/重要の有無）・件数・カード一覧・
 * 象限別の空プレースホルダを描画する。配色はハードコードせず Obsidian テーマ変数に追従する。
 * アクセシビリティ（region ランドマーク・見出し・件数ラベル）を最初から持たせる。
 */
export interface QuadrantCellProps {
  /** 象限名（例: Do / Schedule / Delegate / Delete / 未分類）。region の aria-label にも使う。 */
  label: string;
  /** 軸ラベル（例: 重要 × 緊急）。緊急/重要の有無を明示する。 */
  axisLabel: string;
  /** この象限に属するカード。 */
  entries: MatrixEntry[];
  /** 0 件のときの空プレースホルダ文言。 */
  emptyText?: string;
  /** レイアウト上の種別（未分類ゾーンはフル幅）。 */
  variant?: "quadrant" | "unclassified";
}

const DEFAULT_EMPTY_TEXT = "なし";

export function QuadrantCell({
  label,
  axisLabel,
  entries,
  emptyText = DEFAULT_EMPTY_TEXT,
  variant = "quadrant",
}: QuadrantCellProps) {
  const isEmpty = entries.length === 0;
  return (
    <section
      class={`eisenhower-quadrant eisenhower-quadrant--${variant}`}
      aria-label={`${label}（${axisLabel}）`}
    >
      <header class="eisenhower-quadrant__header">
        <h3 class="eisenhower-quadrant__title">{label}</h3>
        <span class="eisenhower-quadrant__axis">{axisLabel}</span>
        <span class="eisenhower-quadrant__count" aria-label={`${entries.length} 件`}>
          {entries.length}
        </span>
      </header>
      {isEmpty ? (
        <p class="eisenhower-quadrant__empty">{emptyText}</p>
      ) : (
        <ul class="eisenhower-quadrant__list">
          {entries.map((entry) => (
            <li key={entry.id} class="eisenhower-note-card" title={entry.title}>
              {entry.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
