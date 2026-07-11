import { Fragment, render as preactRender } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
// #44: ポップアウト別ウィンドウでカードを掴めるよう、realm 堅牢な派生 sensor を使う
//（dnd-kit の生 sensor は cross-realm ノードで move リスナーをメイン document に張り掴めない）。
import { PopoutKeyboardSensor, PopoutPointerSensor } from "./popoutSensors";
import { QUADRANT_KEYS, axisValuesForQuadrant, type Quadrant } from "../logic/quadrant";
import { messagesFor, type Messages } from "../i18n";
import type { MatrixCallbacks, MatrixViewModel } from "../bases/types";
import {
  applyPendingMoves,
  dropPending,
  isLatestGeneration,
  planSettle,
  reconcilePendingMoves,
  rollbackFailedMove,
  shouldSkipMove,
  type PendingMoves,
} from "./optimisticMove";
import { nextAnnouncement } from "./liveStatus";
import { QuadrantCell } from "./QuadrantCell";
import { UndoToast } from "./UndoToast";

/** 「元に戻す」トーストの自動消滅までの時間（ms）。次のドラッグ開始・undo 実行でも消える。 */
const UNDO_TOAST_TIMEOUT_MS = 8000;

/**
 * 「元に戻す」トーストの自動消滅タイマーを（再）予約してよいかを判定する純関数（WCAG 2.2.1）。
 *
 * ポインタ（hover）とフォーカス（キーボード/AT）の**どちらかがトースト内にある間は再開しない**
 *（＝一時停止を保つ）。両方が外に出て、かつまだタイマーが走っていないときだけ再予約する。
 * focus 片側だけで判定すると、hover 継続中に blur → タイマー再開 → hover 中に消える非対称が起きる
 *（round2 レビュー指摘）。両者を対称に扱うためにここで一元化して単体テストで固定する。
 */
export function shouldRescheduleAutoDismiss(
  pointerInside: boolean,
  focusInside: boolean,
  timerActive: boolean,
): boolean {
  return !pointerInside && !focusInside && !timerActive;
}

/** dnd-kit の Transform 相当（DragOverlay の位置補正に使う x/y/scale）。 */
export interface OverlayTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * DragOverlay（position:fixed）の transform から、portal 先の**包含ブロック原点ずれ**を差し引く純関数（#43 の恒久対策）。
 *
 * overlay の最終ビューポート位置 = 包含ブロック原点 + rect（掴んだカードの矩形）+ transform。
 * #43 の body portal は「body/html の原点＝ビューポート (0,0)」を前提に原点ずれを消すが、Obsidian の
 * バージョン/OS/テーマによっては body/html に `transform` 等が付き fixed 包含ブロック原点が (0,0) から
 * ずれ、掴んだカードが**一定量ずれて浮く**（#43 再燃）。実測した原点を transform から引くと、rect＋ドラッグ量
 * だけの正しい位置に戻る。原点 (0,0)（stock Obsidian で実測）では恒等＝現行の安定挙動を一切変えない。
 * scale は保持する（DragOverlay の adjustScale 既定は false のため通常 1）。
 */
export function compensateOverlayTransform(
  transform: OverlayTransform,
  origin: { x: number; y: number },
): OverlayTransform {
  return { ...transform, x: transform.x - origin.x, y: transform.y - origin.y };
}

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
  // 最新の viewModel を非同期 settle から参照するミラー（毎レンダリングで同期）。in-flight 中に
  // 先着した viewModel を、書き込み settle 後の再突合（reconcileNow）で使う（成功先着レース解消・#4）。
  const viewModelRef = useRef(viewModel);
  viewModelRef.current = viewModel;
  // アンマウント済みかを追う（in-flight 書き込みの settle がアンマウント後に発火して、掃除対象外の
  // タイマー予約＋アンマウント後 setState を起こすのを防ぐガード・レビュー指摘 #5）。
  const mountedRef = useRef(true);
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
  const undoToastTimerRef = useRef<number | null>(null);
  // トースト内にポインタ/フォーカスがあるか（自動消滅の一時停止判定・WCAG 2.2.1）。
  // 両方が外に出たときだけタイマーを再開する（focus 片側だけで判定する非対称を避ける・round2 指摘）。
  const pointerInsideToastRef = useRef(false);
  const focusInsideToastRef = useRef(false);
  // 楽観移動の世代採番（連番）。最新の書き込みだけを確定/ロールバックの対象にする。
  const nextGenerationRef = useRef(0);
  // entryId ごとの in-flight 書き込み数。reconcile の coincidental match 防止に使う。
  const inFlightRef = useRef<Map<string, number>>(new Map());
  // マトリクス領域の参照。トーストのボタンをキーボードで操作するとボタンが即アンマウントされ
  // フォーカスが body へ落ちるため、操作直後にこの安定した受け皿へフォーカスを戻す（a11y・レビュー指摘）。
  const matrixSectionRef = useRef<HTMLElement>(null);
  // DragOverlay（position:fixed）の座標原点を、portal 先（body）の**実効的な包含ブロック原点**へ
  // 合わせて補正するためのオフセット。#43 の body portal は「body/html がビューポート原点 (0,0)」を
  // 前提に原点ずれを消すが、Obsidian のバージョン/OS/テーマによっては body や html に transform 等が
  // 付いて fixed の包含ブロック原点が (0,0) からずれ、掴んだカードが**一定量ずれて浮く**（#43 再燃）。
  // ドラッグ開始時に実原点を測り、その分だけ overlay の transform から差し引く（原点 (0,0) では差引 0＝無変化）。
  const overlayOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // #22（F5）: クリック（開く）とドラッグを両立させるため PointerSensor に距離活性化制約を付け、
  // 5px 未満の移動は掴みにせずクリックとして成立させる。KeyboardSensor の起動/ドロップキーは
  // Space のみに remap し、Enter を「開く」（NoteCard の onKeyDown）へ解放する。
  const sensors = useSensors(
    useSensor(PopoutPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(PopoutKeyboardSensor, {
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
      window.clearTimeout(undoToastTimerRef.current);
      undoToastTimerRef.current = null;
    }
  };
  // 「元に戻す」トーストを消す（タイマーも止める）。undo 実行・閉じる・次のドラッグ開始で呼ぶ。
  const dismissUndoToast = () => {
    clearUndoToastTimer();
    setUndoToast(null);
  };
  // トースト内にフォーカスがあるか（ビューが属する document の activeElement で判定）。
  // グローバル `document.activeElement` はポップアウト別ウィンドウではメイン window を指すため、
  // #44 と同じ document 取り違えを避けて ownerDocument を見る。
  const isFocusInsideToast = (): boolean => {
    const section = matrixSectionRef.current;
    const toast = section?.querySelector(".eisenhower-undo-toast");
    return toast?.contains(section?.ownerDocument.activeElement ?? null) ?? false;
  };
  // 自動消滅タイマーを（再）予約する。予約済みなら張り替える。
  const scheduleUndoToastAutoDismiss = () => {
    clearUndoToastTimer();
    undoToastTimerRef.current = window.setTimeout(() => {
      undoToastTimerRef.current = null;
      // 自動消滅でも、フォーカスがトースト内にある（キーボードで元に戻す/×へ移して待っていた）なら
      // マトリクスへ戻して body への脱落を防ぐ。トースト外（カード等）にフォーカスがあれば横取りしない。
      if (isFocusInsideToast()) matrixSectionRef.current?.focus();
      setUndoToast(null);
    }, UNDO_TOAST_TIMEOUT_MS);
  };
  // 移動成功時にトーストを出し、一定時間後に自動で消す（古い提案を残さない）。
  const showUndoToast = (message: string, entryId: string) => {
    // 新しいトーストは相互作用フラグをリセットしてから採時する（前トーストの残留状態を持ち越さない）。
    pointerInsideToastRef.current = false;
    focusInsideToastRef.current = false;
    setUndoToast({ message, entryId });
    scheduleUndoToastAutoDismiss();
  };
  // WCAG 2.2.1（Timing Adjustable）: フォーカス/ポインタがトースト内にある間は自動消滅を止め、
  // **両方が離れたら**再開する（片側だけで判定する非対称を避ける・round2 指摘）。ポインタ・フォーカスの
  // 出入りを別々に受け、いずれかが内にある間はカウントダウンを止める。
  const updateToastAutoDismiss = () => {
    if (pointerInsideToastRef.current || focusInsideToastRef.current) {
      clearUndoToastTimer();
      return;
    }
    if (shouldRescheduleAutoDismiss(false, false, undoToastTimerRef.current !== null)) {
      scheduleUndoToastAutoDismiss();
    }
  };
  const setToastPointerInside = (inside: boolean) => {
    pointerInsideToastRef.current = inside;
    updateToastAutoDismiss();
  };
  const setToastFocusInside = (inside: boolean) => {
    focusInsideToastRef.current = inside;
    updateToastAutoDismiss();
  };
  // アンマウント時に残ったタイマーを掃除する（リーク防止）。
  useEffect(() => clearUndoToastTimer, []);
  // マウント/アンマウントを追う（settle のアンマウント後発火ガード用・#5）。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 楽観オーバーレイを entryId 単位で落とす関数をアダプタへ登録する（コマンド経由 undo 後の貼り付き解消・#6）。
  // コマンド undo はこのコンポーネントを経由しないため、アダプタから pending を落とせるよう手を渡す。
  // アンマウント時は null で解除する（アンマウント後に setState されないため #5 のガードと二重に安全）。
  useEffect(() => {
    callbacks.registerPendingDropper?.((entryId) =>
      setPending((prev) => dropPending(prev, entryId)),
    );
    return () => callbacks.registerPendingDropper?.(null);
  }, [callbacks]);

  // 最新の viewModel（viewModelRef）と in-flight 状態で保留を再突合し、サーバ値が追いついた保留を落とす純関数の適用。
  // in-flight 中の entry は値一致でも確定しない（coincidental match 防止）。onDataUpdated 由来の再描画（下の
  // useEffect）と、書き込み settle 後の in-flight 解消時（handleDragEnd の settle・#4）が共有する。
  // reconcile は server==pending のときだけ落とすため、サーバ未追従なら保留は残り、フリッカーは起きない。
  const reconcileNow = () => {
    setPending((prev) => {
      if (prev.size === 0) return prev;
      const inFlightIds = new Set(
        [...inFlightRef.current.entries()]
          .filter(([, count]) => count > 0)
          .map(([id]) => id),
      );
      const reconciled = reconcilePendingMoves(
        prev,
        viewModelRef.current.entries,
        inFlightIds,
      );
      return reconciled.size === prev.size ? prev : reconciled;
    });
  };

  // 新しい viewModel（onDataUpdated 由来）が来たら、サーバ値が追いついた保留を解除する。
  useEffect(() => {
    reconcileNow();
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

  // portal 先（ビューが属する document の body）の position:fixed 包含ブロック原点をビューポート座標で測る。
  // top/left=0 の一時 fixed プローブの矩形が、そのまま包含ブロック原点になる（transform/contain いずれ由来でも実測できる）。
  // body/html が (0,0) なら (0,0) を返し、後段の差引は no-op（現行の安定挙動を一切変えない）。
  const measureOverlayOrigin = (): { x: number; y: number } => {
    const doc = matrixSectionRef.current?.ownerDocument;
    const body = doc?.body;
    if (!doc || !body) return { x: 0, y: 0 };
    // 一時的で不可視・即時撤去する計測用プローブ。src/ui は Obsidian 非依存（decoupling）のため
    // Obsidian の createDiv() は使わず標準 DOM の createElement を使う（プレビュー/テストハーネスでも動く）。
    // obsidianmd/prefer-create-el は warning のままにする（decoupled 層の意図的な標準 DOM 使用・bot は非ブロック）。
    const probe = doc.createElement("div");
    // 位置指定はインラインスタイル（no-static-styles-assignment）ではなく CSS クラスで与える。
    probe.className = "eisenhower-cb-origin-probe";
    body.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    body.removeChild(probe);
    return { x: rect.left, y: rect.top };
  };

  // DragOverlay の transform から包含ブロック原点ぶんを差し引く dnd-kit modifier（純関数へ委譲＝単体テスト済み）。
  const compensatePortalOrigin = ({ transform }: { transform: OverlayTransform }) =>
    compensateOverlayTransform(transform, overlayOriginRef.current);

  const handleDragStart = (event: DragStartEvent) => {
    // 掴んだ瞬間の包含ブロック原点を測り、overlay 位置補正に使う（環境依存の原点ずれ＝#43 再燃を吸収）。
    overlayOriginRef.current = measureOverlayOrigin();
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

    // 既に同じ分類なら書き戻さない（同一象限へのドロップを無駄打ちしない・純関数 shouldSkipMove）。
    // 書き込み in-flight 中は保留値を優先する（サーバ未反映でも二重書き込みを防ぐ）。
    const currentAxis =
      pending.get(entryId) ??
      viewModel.entries.find((entry) => entry.id === entryId);
    if (shouldSkipMove(currentAxis, axis)) return;

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
      // ビューが既にアンマウント済み（ドラッグ中にリーフを閉じた/切替）なら状態更新もタイマー予約もしない。
      // さもないと showUndoToast が掃除対象外の 8 秒タイマーを張り、アンマウント済みで setState する（#5）。
      if (!mountedRef.current) return;

      const remaining = (inFlight.get(entryId) ?? 1) - 1;
      if (remaining <= 0) inFlight.delete(entryId);
      else inFlight.set(entryId, remaining);

      // 実行計画（ロールバック/再突合/通知種別/トースト要否）を純関数で決め、以下は機械的に実行する（#2）。
      const isLatest = isLatestGeneration(pendingRef.current, entryId, generation);
      const plan = planSettle(failed, isLatest, Boolean(callbacks.onUndoMove));

      // 最新世代の失敗だけ巻き戻す（古い世代の失敗で新しい移動を巻き戻さない）。
      if (plan.rollback) {
        setPending(
          rollbackFailedMove(pendingRef.current, entryId, generation).pending,
        );
      }
      // 成功 settle で in-flight が解消したので再突合する。in-flight 中に viewModel（サーバ値）が
      // onMoveCard の解決より先着していた場合、reconcile は in-flight 中は保留を残すため確定できず、
      // settle が in-flight を 0 にするだけでは楽観オーバーレイが居残り後続のサーバ変更を隠す（#4）。
      // ここで再突合して server==pending の確定済み保留を落とす（server 未追従なら残る＝フリッカーなし）。
      if (plan.reconcile) reconcileNow();

      const title = titleOf(entryId);
      switch (plan.announce) {
        case "failure":
          announce(messages.moveFailed(title));
          break;
        case "success":
          announce(messages.moveSucceeded(title, labelOf(target)));
          break;
        // 視覚利用者にはトーストで undo 導線が見えるが、非ライブの UndoToast（二重読み上げ回避のため
        // role="group"）は SR/キーボード利用者に通知されず 8 秒で自動消滅する。undo 配線時は aria-live の
        // 成功文言に「コマンドで元に戻せる」旨と到達方法を添えて発見可能性を担保する（#1）。
        case "successUndoable":
          announce(
            messages.moveSucceededUndoable(title, labelOf(target), messages.undoCommandName),
          );
          break;
        case "silent":
          break;
      }
      // undo が配線されているときだけ「元に戻す」トーストを出す（トースト本文は undo 導線ヒント無しの素の成功文言）。
      if (plan.showToast) showUndoToast(messages.moveSucceeded(title, labelOf(target)), entryId);
    };
    // 書き戻しを委譲。成功/失敗いずれも settle へ（Notice はアダプタが出す）。
    callbacks.onMoveCard(entryId, axis).then(
      () => settle(false),
      () => settle(true),
    );
  };

  // 診断表示（#103 F7）: 設定ミス警告バナー（設定ミス確定時のみ）と解決済み軸名の可視化。
  // どちらも ViewModel の diagnostics（既存解決結果の転送）を描画するだけ。loading シェルでは出さない。
  const diagnostics = viewModel.diagnostics;
  // 両軸が同一の書き戻し可能キー＝全カードロックの設定ミス。原因＋直し方を role="note" で提示する
  //（視覚補助＝Issue AC）。aria-live は付けない: 初期レンダーでは polite は元々発火せず、SR 利用者へは
  // 各カードの cardLockedLabel（移動不可）が届く。移動アナウンス専用の sr-status にもバナー文言は載せない。
  // sharedAxisKey は buildDiagnostics が shared 時に必ず設定する（?? urgentAxis は手構築 ViewModel への
  // 防御フォールバック＝shared 時は両者一致＝toFrontmatterKey(ids.urgent)）。
  const diagnosticWarning = diagnostics?.axesShareWritableKey ? (
    <p class="eisenhower-matrix__diag-warning" role="note">
      {messages.diagSharedAxisWarning(diagnostics.sharedAxisKey ?? diagnostics.urgentAxis)}
    </p>
  ) : null;
  // 解決済みの緊急度／重要度軸名を控えめに 1 行で添える（空状態・未分類ヒントで「いまどの軸か」を提示）。
  const axisNames = diagnostics ? (
    <p class="eisenhower-matrix__axis-names">
      {messages.diagAxisNames(diagnostics.urgentAxis, diagnostics.importantAxis)}
    </p>
  ) : null;

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
        {diagnosticWarning}
        <p class="eisenhower-matrix__placeholder">{messages.empty}</p>
        {axisNames}
      </section>
    );
  }

  // 楽観移動を重ねた表示用 placements（純レデューサ）。
  const placements = applyPendingMoves(viewModel.placements, pending);
  // 未分類ゾーンの表示可否（設定 showUnclassified。省略時は表示＝後方互換）。
  const showUnclassified = viewModel.showUnclassified !== false;
  // 完了トグル（#105 F10）: 有効フラグ・状態別 aria-label・トグルハンドラを組み、各セル→カードへ渡す。
  // 完了書き込みは onDataUpdated 再クエリで反映する（Base の done!=true フィルタでカードが消える）。
  // ドラッグのような楽観オーバーレイは持たない（Bases 委譲＝最小実装）。
  const completionEnabled = viewModel.completionEnabled ?? false;
  const dimCompleted = viewModel.dimCompleted ?? false;
  const completionLabel = (isCompleted: boolean) =>
    isCompleted ? messages.completionToggleDone : messages.completionToggle;
  // クロージャ内で narrow するためコールバックを const 捕捉する。完了トグルは楽観オーバーレイを
  // 持たない（カード状態は onDataUpdated 再描画で最新化）ため、書込失敗（アダプタが Notice 済み）の
  // reject は握りつぶして未処理 rejection を防ぐ（ロールバック対象が無い・レビュー指摘）。
  const toggleCompletionCallback = callbacks.onToggleCompletion;
  // 非 boolean 完了値のカードへ x キー操作が来たら、保護中の旨を sr-status へ読み上げる（silent no-op を
  // 避ける・レビュー指摘）。書き込みは起こさない（元値を破壊しない＝AC2）。完了機能が無効なら配線しない。
  const handleCompletionUnsupported = toggleCompletionCallback
    ? () => announce(messages.completionUnsupported)
    : undefined;
  const handleToggleCompletion = toggleCompletionCallback
    ? (entryId: string, done: boolean) => {
        // タイトルは非同期解決の前に捕捉する（done:true は再クエリで entry が消え titleOf が id に退化しうる）。
        const title = titleOf(entryId);
        void toggleCompletionCallback(entryId, done).then(
          () => {
            if (!mountedRef.current) return;
            // 完了トグルの成否を、移動と同じ sr-status ライブ領域へ通知する（Obsidian の Notice は
            // aria-live でなく SR に読まれないため、x キー経路の成否が無通知になるのを塞ぐ・#2/WCAG 4.1.3）。
            announce(messages.completionSucceeded(title));
            // done:true は Base の done!=true フィルタで当該カードが再クエリ後に消えうる。操作していた
            // カード/ボタンが unmount されるとフォーカスが body へ落ちるため、undo と同様にマトリクス領域へ
            // 受け皿として戻し、SR/キーボード利用者の読み進め位置の喪失を防ぐ（#3/WCAG 2.4.3）。
            // done:false（未完了化）は当該カードが表示中＝消えないためフォーカスは動かさない。
            if (done) matrixSectionRef.current?.focus();
          },
          () => {
            if (!mountedRef.current) return;
            announce(messages.completionFailed(title));
          },
        );
      }
    : undefined;
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
      <section
        ref={matrixSectionRef}
        class="eisenhower-matrix"
        role="group"
        aria-label={messages.matrixLabel}
        tabIndex={-1}
      >
        {/* 移動結果（成功/失敗ロールバック）をスクリーンリーダーへ通知する視覚的非表示のライブ領域。
            文言は nextAnnouncement で差分化済み（同一文言でも再読み上げされる）。 */}
        <div class="eisenhower-matrix__sr-status" role="status" aria-live="polite">
          {liveStatus}
        </div>
        {/* 設定ミス警告バナー（両軸同一キー＝全ロック時のみ）。グリッドの前に置き、ロックされたカードを
            見る前に原因＋直し方を提示する（#103 F7）。 */}
        {diagnosticWarning}
        <div class="eisenhower-matrix__grid">
          {QUADRANT_KEYS.map((key) => (
            <QuadrantCell
              key={key}
              quadrant={key}
              label={quadrantLabels[key]}
              axisLabel={messages.axisLabels[key]}
              regionLabel={messages.labelWithAxis(quadrantLabels[key], messages.axisLabels[key])}
              itemCountLabel={messages.itemCount}
              lockedLabel={messages.cardLockedLabel}
              stagnantBadge={messages.stagnantBadge}
              stagnantLabel={messages.stagnantLabel}
              accentColor={quadrantColors?.[key]}
              entries={placements[key]}
              emptyText={messages.emptyQuadrant}
              onOpenCard={callbacks.onOpenCard}
              onHoverCard={callbacks.onHoverCard}
              completionEnabled={completionEnabled}
              completionLabel={completionLabel}
              completionUnsupportedLabel={messages.completionUnsupportedLabel}
              onToggleCompletion={handleToggleCompletion}
              onCompletionUnsupported={handleCompletionUnsupported}
              dimCompleted={dimCompleted}
            />
          ))}
        </div>
        {/* 未分類ゾーン非表示 × 全象限が空 × 未分類にカードあり＝「ready なのに何も見えない」無言の
            空表示を避けるヒント（レビュー指摘）。未分類が表示設定なら下の未分類ゾーンが出るため不要。 */}
        {!showUnclassified &&
          placements.unclassified.length > 0 &&
          QUADRANT_KEYS.every((key) => placements[key].length === 0) && (
            <Fragment>
              <p class="eisenhower-matrix__unclassified-hint" role="note">
                {messages.unclassifiedHidden(placements.unclassified.length)}
              </p>
              {/* 未分類ヒントに解決済み軸名を添える（typo で全未分類のとき「どの軸か」を提示・#103 F7）。 */}
              {axisNames}
            </Fragment>
          )}
        {showUnclassified && (
          <QuadrantCell
            quadrant="unclassified"
            label={messages.unclassifiedLabel}
            axisLabel={messages.unclassifiedAxisLabel}
            regionLabel={messages.labelWithAxis(
              messages.unclassifiedLabel,
              messages.unclassifiedAxisLabel,
            )}
            itemCountLabel={messages.itemCount}
            lockedLabel={messages.cardLockedLabel}
            stagnantBadge={messages.stagnantBadge}
            stagnantLabel={messages.stagnantLabel}
            entries={placements.unclassified}
            emptyText={messages.emptyQuadrant}
            variant="unclassified"
            onOpenCard={callbacks.onOpenCard}
            onHoverCard={callbacks.onHoverCard}
            completionEnabled={completionEnabled}
            completionLabel={completionLabel}
            completionUnsupportedLabel={messages.completionUnsupportedLabel}
            onToggleCompletion={handleToggleCompletion}
            onCompletionUnsupported={handleCompletionUnsupported}
            dimCompleted={dimCompleted}
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
            onPointerInside={setToastPointerInside}
            onFocusInside={setToastFocusInside}
            onUndo={() => {
              // undo は frontmatter を移動前へ戻すので、残っている楽観オーバーレイを先に落として
              // サーバ値の表示へ戻す（さもないと reconcile が「サーバ≠保留・非 in-flight」で保留を
              // 落とせずカードが移動先象限に貼り付く＝レビュー指摘）。コマンド経由の undo（main.ts）は
              // このハンドラを通らないが、undoLastMoveFromCommand が dropPendingOverlay（registerPendingDropper 経由）で
              // 各ビューの pending を落とすため対称に解消される（#6）。
              setPending((prev) => dropPending(prev, undoToast.entryId));
              // 名指しノートの entryId を渡す（記録が別移動へ置き換わっていたら戻さないガード）。
              callbacks.onUndoMove?.(undoToast.entryId);
              dismissUndoToast();
              // 操作したボタンが消えるので、フォーカスをマトリクス領域へ戻す（body へ落とさない）。
              matrixSectionRef.current?.focus();
            }}
            onDismiss={() => {
              dismissUndoToast();
              matrixSectionRef.current?.focus();
            }}
          />
        )}
      </section>
      {/* 掴んでいるカードを象限の overflow:hidden にクリップされず指/カーソルへ追従描画する DragOverlay。
          position:fixed だが、Obsidian の .workspace-leaf は `contain: strict`（layout/paint 包含）で
          **fixed の包含ブロックを新規作成**するため、この階層に置くと原点がビューポートではなくリーフ左上へ
          ずれ、掴んだカードがカーソルからリーフの画面オフセットぶん一定量ずれる（実機バグ・contain は
          devtools で確認済み）。contain されない body 直下へ portal して原点をビューポートへ戻す。
          createPortal は DOM 位置だけを移し、仮想ツリー上は DndContext の子のままなので context は貫通する。
          portal 先はビューが属する document の body（`ownerDocument.body`）＝メイン window でもポップアウト
          別ウィンドウでもそのビュー自身の window に描く（`document.body` グローバル固定だと popout 時に
          overlay がメイン window へ出て消える）。matrixSectionRef はドラッグ中（activeId 非 null）は必ず
          mount 済みで埋まっており、`?? document.body` は activeId=null の描画前だけ通る（そのとき overlay は
          空で実害なし）。「ポップアウトでカードを掴めない」件（#44）は本 portal とは別問題。原因調査で
          起票時の見立て（センサーの別 document 解決）は反証済み＝dnd-kit 6.3.1 の掴み経路は
          `getOwnerDocument(event.target)`/`getWindow(event.target)`（`ownerDocument.defaultView`）で popout を
          正しく解決し realm 安全。真因は活性化/イベント配線側が最有力で実機プローブ待ち（v1 対応・要件 §9）。 */}
      {createPortal(
        <DragOverlay modifiers={[compensatePortalOrigin]}>
          {activeId ? (
            <div class="eisenhower-note-card eisenhower-note-card--overlay">
              <span class="eisenhower-note-card__title">{titleOf(activeId)}</span>
            </div>
          ) : null}
        </DragOverlay>,
        matrixSectionRef.current?.ownerDocument.body ?? activeDocument.body,
      )}
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
