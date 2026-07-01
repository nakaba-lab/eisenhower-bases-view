import { render as preactRender } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { axisValuesForQuadrant, type Quadrant } from "../logic/quadrant";
import type { MatrixCallbacks, MatrixViewModel } from "../bases/types";
import {
  applyPendingMoves,
  isLatestGeneration,
  reconcilePendingMoves,
  rollbackFailedMove,
  settleAnnouncement,
  type PendingMoves,
} from "./optimisticMove";
import { nextAnnouncement } from "./liveStatus";
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

/**
 * スクリーンリーダー向けのキーボード操作説明（dnd-kit の既定英語文を日本語へ差し替える）。
 * #22（F5）で Enter を「開く」に割り当てたため、掴む/ドロップは **Space** に整理する
 *（`KeyboardSensor` の起動キーも Space のみに remap 済み）。
 */
const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "スペースキーで掴み、矢印キーで象限へ移動し、" +
    "スペースキーでドロップします。Esc でキャンセルします。Enter でノートを開きます。",
};

interface MatrixViewProps {
  viewModel: MatrixViewModel;
  callbacks: MatrixCallbacks;
}

function MatrixView({ viewModel, callbacks }: MatrixViewProps) {
  // 楽観移動の保留（entryId → 目的両軸値＋世代）。書込確定で reconcile が落とす（#20）。
  const [pending, setPending] = useState<PendingMoves>(() => new Map());
  // 最新の保留を非同期 settle から参照するためのミラー（毎レンダリングで同期）。
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // ドラッグ中のカード（DragOverlay で指/カーソルへ追従描画する）。
  const [activeId, setActiveId] = useState<string | null>(null);
  // 移動結果（成功/失敗）をスクリーンリーダーへ伝える aria-live 文言（再読み上げ用に差分化済み）。
  const [liveStatus, setLiveStatus] = useState("");
  // 楽観移動の世代採番（連番）。最新の書き込みだけを確定/ロールバックの対象にする。
  const nextGenerationRef = useRef(0);
  // entryId ごとの in-flight 書き込み数。reconcile の coincidental match 防止に使う。
  const inFlightRef = useRef<Map<string, number>>(new Map());
  // #22（F5）: クリック（開く）とドラッグを両立させるため PointerSensor に距離活性化制約を付け、
  // 5px 未満の移動は掴みにせずクリックとして成立させる。KeyboardSensor の起動/ドロップキーは
  // Space のみに remap し、Enter を「開く」（NoteCard の onKeyDown）へ解放する。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  // aria-live へ通知する（同一文言でも nextAnnouncement が差分化して再読み上げを促す）。
  const announce = (message: string) =>
    setLiveStatus((prev) => nextAnnouncement(prev, message));

  // 新しい viewModel（onDataUpdated 由来）が来たら、サーバ値が追いついた保留を解除する。
  // in-flight 中の entry は値一致でも確定しない（coincidental match 防止）。
  useEffect(() => {
    setPending((prev) => {
      if (prev.size === 0) return prev;
      const inFlightIds = new Set(
        [...inFlightRef.current.entries()]
          .filter(([, count]) => count > 0)
          .map(([id]) => id),
      );
      const reconciled = reconcilePendingMoves(
        prev,
        viewModel.entries,
        inFlightIds,
      );
      return reconciled.size === prev.size ? prev : reconciled;
    });
  }, [viewModel]);

  const titleOf = (id: string): string =>
    viewModel.entries.find((entry) => entry.id === id)?.title ?? id;
  const labelOf = (quadrant: Quadrant): string =>
    QUADRANTS.find((q) => q.key === quadrant)?.label ??
    (quadrant === "unclassified" ? UNCLASSIFIED_LABEL : quadrant);

  // スクリーンリーダーへ各操作段階を日本語で読み上げる（dnd-kit 既定の英語＋内部 ID を置換）。
  const announcements = {
    onDragStart({ active }: DragStartEvent) {
      return `「${titleOf(String(active.id))}」を掴みました。象限へ移動してください。`;
    },
    onDragOver({ over }: DragOverEvent) {
      return over
        ? `${labelOf(String(over.id) as Quadrant)} の上にあります。`
        : "ドロップ可能な象限の外にあります。";
    },
    onDragEnd({ active, over }: DragEndEvent) {
      return over
        ? `「${titleOf(String(active.id))}」を ${labelOf(String(over.id) as Quadrant)} にドロップしました。`
        : `「${titleOf(String(active.id))}」を元の位置に戻しました。`;
    },
    onDragCancel({ active }: DragCancelEvent) {
      return `「${titleOf(String(active.id))}」の移動をキャンセルしました。`;
    },
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };
  const handleDragCancel = () => setActiveId(null);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !callbacks.onMoveCard) return;
    const entryId = String(active.id);
    const target = String(over.id) as Quadrant;
    const axis = axisValuesForQuadrant(target);
    if (!axis) return; // 未分類など書き戻し不可な対象は no-op（AC4 の二重ガード）

    // 既に同じ分類なら書き戻さない（同一象限へのドロップを無駄打ちしない）。
    // 書き込み in-flight 中は保留値を優先する（サーバ未反映でも二重書き込みを防ぐ）。
    const currentAxis =
      pending.get(entryId) ??
      viewModel.entries.find((entry) => entry.id === entryId);
    if (
      currentAxis &&
      currentAxis.urgent === axis.urgent &&
      currentAxis.important === axis.important
    ) {
      return;
    }

    // この移動の世代を採番し、in-flight 数を増やす。
    const generation = (nextGenerationRef.current += 1);
    const inFlight = inFlightRef.current;
    inFlight.set(entryId, (inFlight.get(entryId) ?? 0) + 1);

    // 楽観移動: 保留に積んで即再描画。
    setPending((prev) => {
      const next = new Map(prev);
      next.set(entryId, { ...axis, generation });
      return next;
    });

    // 書き込みの settle（成功/失敗）で in-flight を減らし、最新世代か（後続ドラッグに上書きされて
    // いないか）でロールバックと通知を決める。最新の保留は非同期実行時点の pendingRef で見る。
    // ロールバック判定（rollbackFailedMove）も通知判定（settleAnnouncement）も純関数＝単体テスト済み。
    const settle = (failed: boolean) => {
      const remaining = (inFlight.get(entryId) ?? 1) - 1;
      if (remaining <= 0) inFlight.delete(entryId);
      else inFlight.set(entryId, remaining);

      const isLatest = isLatestGeneration(pendingRef.current, entryId, generation);
      // 最新世代の失敗だけ巻き戻す（古い世代の失敗で新しい移動を巻き戻さない）。
      if (failed && isLatest) {
        setPending(
          rollbackFailedMove(pendingRef.current, entryId, generation).pending,
        );
      }
      switch (settleAnnouncement(failed, isLatest)) {
        case "failure":
          announce(`「${titleOf(entryId)}」の移動に失敗しました。元に戻しました。`);
          break;
        case "success":
          announce(`「${titleOf(entryId)}」を ${labelOf(target)} へ移動しました。`);
          break;
      }
    };
    // 書き戻しを委譲。成功/失敗いずれも settle へ（Notice はアダプタが出す）。
    callbacks.onMoveCard(entryId, axis).then(
      () => settle(false),
      () => settle(true),
    );
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
  // 未分類ゾーンの表示可否（設定 showUnclassified。省略時は表示＝後方互換）。
  const showUnclassified = viewModel.showUnclassified !== false;
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        announcements,
        screenReaderInstructions: SCREEN_READER_INSTRUCTIONS,
      }}
    >
      <section class="eisenhower-matrix" role="group" aria-label={MATRIX_LABEL}>
        {/* 移動結果（成功/失敗ロールバック）をスクリーンリーダーへ通知する視覚的非表示のライブ領域。
            文言は nextAnnouncement で差分化済み（同一文言でも再読み上げされる）。 */}
        <div class="eisenhower-matrix__sr-status" role="status" aria-live="polite">
          {liveStatus}
        </div>
        <div class="eisenhower-matrix__grid">
          {QUADRANTS.map((quadrant) => (
            <QuadrantCell
              key={quadrant.key}
              quadrant={quadrant.key}
              label={quadrant.label}
              axisLabel={quadrant.axisLabel}
              entries={placements[quadrant.key]}
              emptyText={EMPTY_QUADRANT_TEXT}
              onOpenCard={callbacks.onOpenCard}
              onHoverCard={callbacks.onHoverCard}
            />
          ))}
        </div>
        {/* showUnclassified=false かつ全カードが未分類（例: 両軸が非 note.* 解決）の構成では、
            未分類ゾーン非表示で「ready なのに何も出ない」無言の空表示になりうる（レビュー指摘 #9）。
            非 note.* 軸の警告・件数ヒントは F4（#21）/F6（#23・切替 UI 導入時）で本格対応する。 */}
        {showUnclassified && (
          <QuadrantCell
            quadrant="unclassified"
            label={UNCLASSIFIED_LABEL}
            axisLabel={UNCLASSIFIED_AXIS_LABEL}
            entries={placements.unclassified}
            emptyText={EMPTY_QUADRANT_TEXT}
            variant="unclassified"
            onOpenCard={callbacks.onOpenCard}
            onHoverCard={callbacks.onHoverCard}
          />
        )}
      </section>
      {/* 掴んでいるカードを象限の overflow:hidden にクリップされず指/カーソルへ追従描画する。 */}
      <DragOverlay>
        {activeId ? (
          <div class="eisenhower-note-card eisenhower-note-card--overlay">
            {titleOf(activeId)}
          </div>
        ) : null}
      </DragOverlay>
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
