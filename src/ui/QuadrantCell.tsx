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
  /**
   * 象限アクセント色（#23 F6）。非空なら CSS 変数 `--eisenhower-quadrant-accent` として
   * セルに付与し、`styles.css` が参照する。空/未指定はテーマ既定（`--interactive-accent`）に委ねる。
   */
  accentColor?: string;
  /** カードを開く（#22 F5）。各 NoteCard へ委譲する。 */
  onOpenCard?: (entryId: string, opts: { newLeaf: boolean }) => void;
  /** カードのホバーでプレビュー（#22 F5）。各 NoteCard へ委譲する。 */
  onHoverCard?: (entryId: string, targetEl: HTMLElement, event: MouseEvent) => void;
  /**
   * 領域（section）のアクセシブル名（例: "Do (Important × Urgent)"）。#23 F6 の i18n で
   * `messages.labelWithAxis` により言語別の括弧で組んで渡す。省略時は現行の全角括弧結合にフォールバック。
   */
  regionLabel?: string;
  /**
   * 件数バッジのアクセシブル名を件数から組む（例: "5 items" / "5 件"）。#23 F6 の i18n で
   * `messages.itemCount` を渡す。省略時は現行の日本語「件」にフォールバック。
   */
  itemCountLabel?: (count: number) => string;
  /** ロックカード（`entry.locked`）のアクセシブル名を組む（i18n `messages.cardLockedLabel`）。各 NoteCard へ委譲。 */
  lockedLabel?: (title: string) => string;
  /** 滞留バッジ本文を経過日数から組む（i18n `messages.stagnantBadge`・#106）。各 NoteCard へ委譲。 */
  stagnantBadge?: (days: number) => string;
  /** 滞留バッジの aria-label を経過日数から組む（i18n `messages.stagnantLabel`・#106）。各 NoteCard へ委譲。 */
  stagnantLabel?: (days: number) => string;
  /** 完了トグル（#105 F10）が有効か。各 NoteCard へ委譲する。 */
  completionEnabled?: boolean;
  /** 完了チェックボタンの aria-label（ノート名＋状態別操作・i18n）。各 NoteCard がノート名で解決する。 */
  completionLabel?: (title: string, completed: boolean) => string;
  /** 無効化された完了ボタンの理由ラベル（ノート名込み・i18n `completionUnsupportedLabel`・#105 F10）。各 NoteCard へ委譲。 */
  completionUnsupportedLabel?: (title: string) => string;
  /** 完了状態をトグルする（#105 F10）。各 NoteCard へ委譲する。 */
  onToggleCompletion?: (entryId: string, done: boolean) => void;
  /** 非 boolean 完了値のカードへの x キー操作の通知（#105 F10）。各 NoteCard へ委譲する。 */
  onCompletionUnsupported?: (entryId: string) => void;
  /** 完了ノートを淡色表示するか（設定 `dimCompleted`・#105 F10）。各 NoteCard へ委譲する。 */
  dimCompleted?: boolean;
}

const DEFAULT_EMPTY_TEXT = "なし";
/** 後方互換フォールバック（presentation 未配線時）: 現行の日本語カウンタと全角括弧結合。 */
const DEFAULT_ITEM_COUNT = (count: number) => `${count} 件`;

export function QuadrantCell({
  quadrant,
  label,
  axisLabel,
  entries,
  emptyText = DEFAULT_EMPTY_TEXT,
  variant = "quadrant",
  accentColor,
  onOpenCard,
  onHoverCard,
  regionLabel,
  itemCountLabel = DEFAULT_ITEM_COUNT,
  lockedLabel,
  stagnantBadge,
  stagnantLabel,
  completionEnabled,
  completionLabel,
  completionUnsupportedLabel,
  onToggleCompletion,
  onCompletionUnsupported,
  dimCompleted,
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
  // カスタム色（非空）はインライン CSS 変数で付与。空/未指定はテーマ既定にフォールバック（#23 F6）。
  const accentStyle =
    accentColor && accentColor.length > 0
      ? { "--eisenhower-quadrant-accent": accentColor }
      : undefined;
  return (
    <section
      ref={setNodeRef}
      class={className}
      style={accentStyle}
      aria-label={regionLabel ?? `${label}（${axisLabel}）`}
    >
      <header class="eisenhower-quadrant__header">
        <h3 class="eisenhower-quadrant__title">{label}</h3>
        <span class="eisenhower-quadrant__axis">{axisLabel}</span>
        <span
          class="eisenhower-quadrant__count"
          role="img"
          aria-label={itemCountLabel(entries.length)}
        >
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
              lockedLabel={lockedLabel}
              stagnantBadge={stagnantBadge}
              stagnantLabel={stagnantLabel}
              completionEnabled={completionEnabled}
              completionLabel={completionLabel}
              completionUnsupportedLabel={completionUnsupportedLabel}
              onToggleCompletion={onToggleCompletion}
              onCompletionUnsupported={onCompletionUnsupported}
              dimCompleted={dimCompleted}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
