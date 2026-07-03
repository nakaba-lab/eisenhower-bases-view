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
import { QUADRANT_KEYS, axisValuesForQuadrant, type Quadrant } from "../logic/quadrant";
import { messagesFor, type Messages } from "../i18n";
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
import { UndoToast } from "./UndoToast";

/** 「元に戻す」トーストの自動消滅までの時間（ms）。次のドラッグ開始・undo 実行でも消える。 */
const UNDO_TOAST_TIMEOUT_MS = 8000;

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

/**
 * ユーザー向け文言は ViewModel の `presentation`（#23 F6）から受け取る。
 * `presentation` 省略時（後方互換・ローディングシェル）は下記の既定にフォールバックする＝
 * **現行のハードコード挙動**（英ラベル＋日本語文言）。ja メッセージをベースに象限ラベルだけ
 * 英語へ差し替えて再現する（アダプタは常に `presentation` を載せるため実機では解決済み文言を使う）。
 */
const FALLBACK_MESSAGES: Messages = {
  ...messagesFor("ja"),
  quadrantLabels: { do: "Do", schedule: "Schedule", delegate: "Delegate", delete: "Delete" },
};

interface MatrixViewProps {
  viewModel: MatrixViewModel;
  callbacks: MatrixCallbacks;
}

function MatrixView({ viewModel, callbacks }: MatrixViewProps) {
  // 表示情報（ラベル/色/言語文言）を presentation から取り出す（#23 F6）。
  // 省略時（後方互換・ローディングシェル）は現行挙動の既定へフォールバックする。
  const presentation = viewModel.presentation;
  const messages = presentation?.messages ?? FALLBACK_MESSAGES;
  const quadrantLabels = presentation?.quadrantLabels ?? FALLBACK_MESSAGES.quadrantLabels;
  const quadrantColors = presentation?.quadrantColors;

  // 楽観移動の保留（entryId → 目的両軸値＋世代）。書込確定で reconcile が落とす（#20）。
  const [pending, setPending] = useState<PendingMoves>(() => new Map());
  // 最新の保留を非同期 settle から参照するためのミラー（毎レンダリングで同期）。
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // ドラッグ中のカード（DragOverlay で指/カーソルへ追従描画する）。
  const [activeId, setActiveId] = useState<string | null>(null);
  // 移動結果（成功/失敗）をスクリーンリーダーへ伝える aria-live 文言（再読み上げ用に差分化済み）。
  const [liveStatus, setLiveStatus] = useState("");
  // 移動成功直後に出す「元に戻す」トースト（undo・最小実装）。null で非表示。
  // entryId は onUndoMove に渡し、記録が別移動へ置き換わった陳腐化トーストで別ノートを戻さないためのガード。
  const [undoToast, setUndoToast] = useState<
    { message: string; entryId: string } | null
  >(null);
  // トーストの自動消滅タイマー（次のドラッグ開始・undo 実行・アンマウントでもクリアする）。
  const undoToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      // start は Space のみ（Enter は「開く」に解放）。end は Space に加え **Tab も残す**＝
      // ドラッグ中に Tab でフォーカスを移すと dnd-kit がドロップ確定する既定挙動を保つ（Enter だけ外す。レビュー指摘）。
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Tab"] },
    }),
  );

  // aria-live へ通知する（同一文言でも nextAnnouncement が差分化して再読み上げを促す）。
  const announce = (message: string) =>
    setLiveStatus((prev) => nextAnnouncement(prev, message));

  // 自動消滅タイマーを止める（show/dismiss/アンマウントで共有）。
  const clearUndoToastTimer = () => {
    if (undoToastTimerRef.current !== null) {
      clearTimeout(undoToastTimerRef.current);
      undoToastTimerRef.current = null;
    }
  };
  // 「元に戻す」トーストを消す（タイマーも止める）。undo 実行・閉じる・次のドラッグ開始で呼ぶ。
  const dismissUndoToast = () => {
    clearUndoToastTimer();
    setUndoToast(null);
  };
  // 移動成功時にトーストを出し、一定時間後に自動で消す（古い提案を残さない）。
  const showUndoToast = (message: string, entryId: string) => {
    clearUndoToastTimer();
    setUndoToast({ message, entryId });
    undoToastTimerRef.current = setTimeout(() => {
      undoToastTimerRef.current = null;
      setUndoToast(null);
    }, UNDO_TOAST_TIMEOUT_MS);
  };
  // アンマウント時に残ったタイマーを掃除する（リーク防止）。
  useEffect(() => clearUndoToastTimer, []);

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
    quadrant === "unclassified" ? messages.unclassifiedLabel : quadrantLabels[quadrant];

  // スクリーンリーダーへ各操作段階を読み上げる（dnd-kit 既定の英語＋内部 ID を言語文言＋名称へ置換）。
  const announcements = {
    onDragStart({ active }: DragStartEvent) {
      return messages.grabbed(titleOf(String(active.id)));
    },
    onDragOver({ over }: DragOverEvent) {
      return over
        ? messages.over(labelOf(String(over.id) as Quadrant))
        : messages.outside;
    },
    onDragEnd({ active, over }: DragEndEvent) {
      return over
        ? messages.dropped(titleOf(String(active.id)), labelOf(String(over.id) as Quadrant))
        : messages.returnedToOrigin(titleOf(String(active.id)));
    },
    onDragCancel({ active }: DragCancelEvent) {
      return messages.cancelled(titleOf(String(active.id)));
    },
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    // 新しいドラッグを始めたら、直前の移動の「元に戻す」提案は古くなるため消す。
    dismissUndoToast();
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
          announce(messages.moveFailed(titleOf(entryId)));
          break;
        case "success": {
          const successMessage = messages.moveSucceeded(titleOf(entryId), labelOf(target));
          announce(successMessage);
          // undo が配線されているときだけ「元に戻す」トーストを出す（onUndoMove 未提供なら出さない）。
          if (callbacks.onUndoMove) showUndoToast(successMessage, entryId);
          break;
        }
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
        {messages.loading}
      </div>
    );
  }

  if (viewModel.state === "empty") {
    return (
      <section
        class="eisenhower-matrix eisenhower-matrix--empty"
        role="group"
        aria-label={messages.matrixLabel}
      >
        <p class="eisenhower-matrix__placeholder">{messages.empty}</p>
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
        screenReaderInstructions: { draggable: messages.screenReaderDraggable },
      }}
    >
      <section class="eisenhower-matrix" role="group" aria-label={messages.matrixLabel}>
        {/* 移動結果（成功/失敗ロールバック）をスクリーンリーダーへ通知する視覚的非表示のライブ領域。
            文言は nextAnnouncement で差分化済み（同一文言でも再読み上げされる）。 */}
        <div class="eisenhower-matrix__sr-status" role="status" aria-live="polite">
          {liveStatus}
        </div>
        <div class="eisenhower-matrix__grid">
          {QUADRANT_KEYS.map((key) => (
            <QuadrantCell
              key={key}
              quadrant={key}
              label={quadrantLabels[key]}
              axisLabel={messages.axisLabels[key]}
              accentColor={quadrantColors?.[key]}
              entries={placements[key]}
              emptyText={messages.emptyQuadrant}
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
            label={messages.unclassifiedLabel}
            axisLabel={messages.unclassifiedAxisLabel}
            entries={placements.unclassified}
            emptyText={messages.emptyQuadrant}
            variant="unclassified"
            onOpenCard={callbacks.onOpenCard}
            onHoverCard={callbacks.onHoverCard}
          />
        )}
        {/* 移動成功直後の「元に戻す」トースト（undo・最小実装）。onUndoMove 配線時のみ。
            クリックでアダプタの復元経路へ委譲し、閉じる/次ドラッグ/タイムアウトで消える。 */}
        {undoToast && callbacks.onUndoMove && (
          <UndoToast
            message={undoToast.message}
            regionLabel={messages.undoRegionLabel}
            undoLabel={messages.undoMove}
            dismissLabel={messages.undoDismiss}
            onUndo={() => {
              // 名指しノートの entryId を渡す（記録が別移動へ置き換わっていたら戻さないガード）。
              callbacks.onUndoMove?.(undoToast.entryId);
              dismissUndoToast();
            }}
            onDismiss={dismissUndoToast}
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
