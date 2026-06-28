/**
 * 1 つの象限セル（カードのドロップ先になる領域）の表示用コンポーネント。
 *
 * 雛形段階の最小実装。ドラッグ＆ドロップ（dnd-kit）・カード一覧・テーマ追従の
 * 本実装は UI 実装フェーズで行う。アクセシビリティ（aria-label・見出し）を最初から持たせる。
 */
export interface QuadrantCellProps {
  /** 象限のラベル（例: Do / Schedule / Delegate / Delete / 未分類）。 */
  label: string;
  /** この象限に属するカード件数。 */
  count: number;
}

export function QuadrantCell({ label, count }: QuadrantCellProps) {
  return (
    <section class="eisenhower-quadrant" aria-label={label}>
      <h3 class="eisenhower-quadrant__title">{label}</h3>
      <span class="eisenhower-quadrant__count">{count}</span>
    </section>
  );
}
