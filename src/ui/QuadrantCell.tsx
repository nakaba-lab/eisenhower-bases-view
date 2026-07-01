import { useDroppable } from "@dnd-kit/core";
import type { Quadrant } from "../logic/quadrant";
import type { MatrixEntry } from "../bases/types";
import { NoteCard } from "./NoteCard";

/**
 * 1 つの象限（または未分類ゾーン）のセル。カードのドロップ先になる領域。
 *
 * #19（F2）: 象限ラベル・軸ラベル（緊急/重要の有無）・件数・カード一覧・象限別の空プレースホルダ。
 * #20（F3）: dnd-kit の `useDroppable` でドロップ先にする。**未分類ゾーンは `disabled`**＝
 * ドロップ先にしない（軸欠損は書き戻し対象にしない＝AC4）。配色はハードコードせず
 * Obsidian テーマ変数に追従する。アクセシビリティ（region・見出し・件数ラベル）を最初から持たせる。
 */
export interface QuadrantCellProps {
  /** ドロップ先 ID に使う象限キー（純ロジックの {@link Quadrant} を真実源にする）。 */
  quadrant: Quadrant;
  /** 象限名（例: Do / Schedule / Delegate / Delete / 未分類）。region の aria-label にも使う。 */
  label: string;
  /** 軸ラベル（例: 重要 × 緊急）。緊急/重要の有無を明示する。 */
  axisLabel: string;
  /** この象限に属するカード。 */
  entries: MatrixEntry[];
  /** 0 件のときの空プレースホルダ文言。 */
  emptyText?: string;
  /** レイアウト上の種別（未分類ゾーンはフル幅・ドロップ不可）。 */
  variant?: "quadrant" | "unclassified";
  /** カードを開く（#22 F5）。各 NoteCard へ委譲する。 */
  onOpenCard?: (entryId: string, opts: { newLeaf: boolean }) => void;
  /** カードのホバーでプレビュー（#22 F5）。各 NoteCard へ委譲する。 */
  onHoverCard?: (entryId: string, targetEl: HTMLElement, event: MouseEvent) => void;
}

const DEFAULT_EMPTY_TEXT = "なし";

export function QuadrantCell({
  quadrant,
  label,
  axisLabel,
  entries,
  emptyText = DEFAULT_EMPTY_TEXT,
  variant = "quadrant",
  onOpenCard,
  onHoverCard,
}: QuadrantCellProps) {
  // 未分類はドロップ先にしない（AC4）。4 象限のみ droppable にする。
  const isDropDisabled = variant === "unclassified";
  const { setNodeRef, isOver } = useDroppable({
    id: quadrant,
    disabled: isDropDisabled,
  });
  const isEmpty = entries.length === 0;
  const className =
    `eisenhower-quadrant eisenhower-quadrant--${variant}` +
    (isOver && !isDropDisabled ? " eisenhower-quadrant--over" : "");
  return (
    <section
      ref={setNodeRef}
      class={className}
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
            <NoteCard
              key={entry.id}
              entry={entry}
              onOpenCard={onOpenCard}
              onHoverCard={onHoverCard}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
