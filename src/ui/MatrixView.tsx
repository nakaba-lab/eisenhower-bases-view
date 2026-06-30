import { render as preactRender } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { axisValuesForQuadrant, type Quadrant } from "../logic/quadrant";
import type { MatrixCallbacks, MatrixViewModel } from "../bases/types";
import {
  applyPendingMoves,
  reconcilePendingMoves,
  type PendingMoves,
} from "./optimisticMove";
import { QuadrantCell } from "./QuadrantCell";

/**
 * Matrix ビューの命令的な描画入口（アダプタ層が onDataUpdated 内で呼ぶ＝AC3）。
 *
 * #19（F2）: 2×2 グリッド（Do/Schedule/Delegate/Delete）＋下部フル幅の未分類ゾーンを
 * `placements` から描画する（事前グルーピング済みのため UI は配置のみ）。
 * #20（F3）: `DndContext` でカードのドラッグ書き戻しを行う。ドロップ先象限から
 * `axisValuesForQuadrant` で両軸値を求め、**楽観的に移動**（`applyPendingMoves`）してから
 * `callbacks.onMoveCard` でアダプタへ委譲する。成功は `onDataUpdated` 再描画＋`reconcile` で整合、
 * 失敗は保留を破棄してロールバックする（Notice はアダプタが表示）。
 * 配色はハードコードせず Obsidian テーマ変数（styles.css）に追従する。
 */

// ユーザー向け文言。i18n（#23 F6）導入時はここを起点に翻訳テーブルへ差し替える。
const MATRIX_LABEL = "Eisenhower Matrix";
const LOADING_TEXT = "読み込み中…";
const EMPTY_TEXT = "表示するノートがありません";
const EMPTY_QUADRANT_TEXT = "なし";

/** 2×2 グリッドの象限定義（ワイヤーフレーム順: 上段 Do/Schedule、下段 Delegate/Delete）。 */
const QUADRANTS = [
  { key: "do", label: "Do", axisLabel: "重要 × 緊急" },
  { key: "schedule", label: "Schedule", axisLabel: "重要 × 非緊急" },
  { key: "delegate", label: "Delegate", axisLabel: "非重要 × 緊急" },
  { key: "delete", label: "Delete", axisLabel: "非重要 × 非緊急" },
] as const;

const UNCLASSIFIED_LABEL = "未分類";
const UNCLASSIFIED_AXIS_LABEL = "軸欠損・ドロップ不可";

interface MatrixViewProps {
  viewModel: MatrixViewModel;
  callbacks: MatrixCallbacks;
}

function MatrixView({ viewModel, callbacks }: MatrixViewProps) {
  // 楽観移動の保留（entryId → 目的両軸値）。書込確定で reconcile が落とす（#20）。
  const [pending, setPending] = useState<PendingMoves>(() => new Map());
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  // 新しい viewModel（onDataUpdated 由来）が来たら、サーバ値が追いついた保留を解除する。
  useEffect(() => {
    setPending((prev) => {
      if (prev.size === 0) return prev;
      const reconciled = reconcilePendingMoves(prev, viewModel.entries);
      return reconciled.size === prev.size ? prev : reconciled;
    });
  }, [viewModel]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !callbacks.onMoveCard) return;
    const entryId = String(active.id);
    const target = String(over.id) as Quadrant;
    const axis = axisValuesForQuadrant(target);
    if (!axis) return; // 未分類など書き戻し不可な対象は no-op（AC4 の二重ガード）

    // 既に同じ分類なら書き戻さない（同一象限へのドロップを無駄打ちしない）。
    const current = viewModel.entries.find((entry) => entry.id === entryId);
    if (
      current &&
      current.urgent === axis.urgent &&
      current.important === axis.important
    ) {
      return;
    }

    // 楽観移動: 保留に積んで即再描画。
    setPending((prev) => {
      const next = new Map(prev);
      next.set(entryId, axis);
      return next;
    });
    // 書き戻しを委譲。失敗したら保留を破棄してロールバック（Notice はアダプタが出す）。
    callbacks.onMoveCard(entryId, axis).catch(() => {
      setPending((prev) => {
        const next = new Map(prev);
        next.delete(entryId);
        return next;
      });
    });
  };

  if (viewModel.state === "loading") {
    return (
      <div
        class="eisenhower-matrix eisenhower-matrix--loading"
        role="status"
        aria-live="polite"
      >
        {LOADING_TEXT}
      </div>
    );
  }

  if (viewModel.state === "empty") {
    return (
      <section
        class="eisenhower-matrix eisenhower-matrix--empty"
        role="group"
        aria-label={MATRIX_LABEL}
      >
        <p class="eisenhower-matrix__placeholder">{EMPTY_TEXT}</p>
      </section>
    );
  }

  // 楽観移動を重ねた表示用 placements（純レデューサ）。
  const placements = applyPendingMoves(viewModel.placements, pending);
  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <section class="eisenhower-matrix" role="group" aria-label={MATRIX_LABEL}>
        <div class="eisenhower-matrix__grid">
          {QUADRANTS.map((quadrant) => (
            <QuadrantCell
              key={quadrant.key}
              quadrant={quadrant.key}
              label={quadrant.label}
              axisLabel={quadrant.axisLabel}
              entries={placements[quadrant.key]}
              emptyText={EMPTY_QUADRANT_TEXT}
            />
          ))}
        </div>
        <QuadrantCell
          quadrant="unclassified"
          label={UNCLASSIFIED_LABEL}
          axisLabel={UNCLASSIFIED_AXIS_LABEL}
          entries={placements.unclassified}
          emptyText={EMPTY_QUADRANT_TEXT}
          variant="unclassified"
        />
      </section>
    </DndContext>
  );
}

/**
 * ViewModel を `containerEl` に Preact 描画する（再呼び出しで差分更新）。
 */
export function render(
  container: HTMLElement,
  viewModel: MatrixViewModel,
  callbacks: MatrixCallbacks = {},
): void {
  preactRender(<MatrixView viewModel={viewModel} callbacks={callbacks} />, container);
}

/**
 * Preact ルートを破棄してコンテナを空にする（リーク防止＝AC4）。
 */
export function unmount(container: HTMLElement): void {
  preactRender(null, container);
}
