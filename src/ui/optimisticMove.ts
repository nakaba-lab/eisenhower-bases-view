/**
 * ドラッグ書き戻し（#20 F3）の楽観更新＋ロールバックを担う純レデューサ。
 *
 * dnd-kit のドラッグ実操作・`processFrontMatter` の往復は手動/結合で担保し、
 * ここには **Bases/dnd-kit/Preact に依存しない状態遷移ロジックだけ**を置く
 *（楽観適用 `applyPendingMoves` / 確定判定 `reconcilePendingMoves`）。単体 TDD の対象。
 */
import { classifyQuadrant, type Quadrant } from "../logic/quadrant";
import type { MatrixEntry, QuadrantPlacements } from "../bases/types";

/** 1 つの保留中移動の目的両軸値（書き込み確定前の楽観値）。 */
export interface PendingAxisValues {
  urgent: boolean;
  important: boolean;
  /**
   * 楽観移動の世代（連番）。同一カードを in-flight 中に連続ドラッグしたとき、
   * 最新の書き込みだけを確定/ロールバックの対象にするために使う（UI 側で付与）。
   * 純レデューサ（applyPendingMoves）は参照しない。
   */
  generation?: number;
}

/** 保留中の移動: entryId（file.path）→ 目的象限の両軸値。 */
export type PendingMoves = Map<string, PendingAxisValues>;

const QUADRANT_KEYS: Quadrant[] = [
  "do",
  "schedule",
  "delegate",
  "delete",
  "unclassified",
];

/** placements の各象限配列を浅くコピーした新オブジェクトを作る（入力を破壊しない）。 */
function clonePlacements(placements: QuadrantPlacements): QuadrantPlacements {
  const next = {} as QuadrantPlacements;
  for (const key of QUADRANT_KEYS) {
    next[key] = [...placements[key]];
  }
  return next;
}

/** 全象限から id 一致のエントリを取り除いて返す（無ければ undefined・placements を破壊変更）。 */
function removeEntry(
  placements: QuadrantPlacements,
  id: string,
): MatrixEntry | undefined {
  for (const key of QUADRANT_KEYS) {
    const idx = placements[key].findIndex((e) => e.id === id);
    if (idx !== -1) return placements[key].splice(idx, 1)[0];
  }
  return undefined;
}

/**
 * 保留中の移動を placements に重ねた**新しい** placements を返す（純関数）。
 *
 * 各保留 entry を現在の象限から取り除き、両軸値を上書きして
 * `classifyQuadrant`（両軸とも boolean なので必ず 4 象限のいずれか＝未分類にはならない）
 * で決まる目的象限へ移す。保留 id が見つからなければ無視する（防御）。
 */
export function applyPendingMoves(
  placements: QuadrantPlacements,
  pending: PendingMoves,
): QuadrantPlacements {
  if (pending.size === 0) return clonePlacements(placements);

  const next = clonePlacements(placements);
  for (const [id, axis] of pending) {
    const current = removeEntry(next, id);
    if (!current) continue; // 見つからない保留は無視（防御）
    next[classifyQuadrant(axis)].push({
      ...current,
      urgent: axis.urgent,
      important: axis.important,
    });
  }
  return next;
}

/**
 * サーバ値（最新 entries）と突合し、**確定済み（サーバが保留値に追いついた）**または
 * **消滅した**保留を落とした新しい {@link PendingMoves} を返す（純関数）。
 *
 * 書き込み成功 → `onDataUpdated` 再描画で entries が更新された後に呼び、楽観オーバーレイを
 * 解除する。まだ追いついていない保留は残す（書き込み in-flight）。
 *
 * `inFlightIds` を渡すと、**書き込みがまだ in-flight の entry はサーバ値が偶然一致しても確定としない**。
 * 同一カードを連続ドラッグして in-flight が重なると、古いサーバスナップショットが最新保留値と
 * 偶然一致して保留を早期に落とし、後続の書き込み着弾でユーザー最終意図と表示が食い違う事故
 *（coincidental match）を防ぐ。in-flight が解消してから値一致で確定する。
 */
export function reconcilePendingMoves(
  pending: PendingMoves,
  entries: readonly MatrixEntry[],
  inFlightIds?: ReadonlySet<string>,
): PendingMoves {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const next: PendingMoves = new Map();
  for (const [id, axis] of pending) {
    const entry = byId.get(id);
    if (!entry) continue; // サーバから消えた → 保留破棄
    const confirmed =
      entry.urgent === axis.urgent && entry.important === axis.important;
    const stillWriting = inFlightIds?.has(id) ?? false;
    // まだ反映前、または書き込み in-flight 中（coincidental match 防止）は残す。
    if (!confirmed || stillWriting) next.set(id, axis);
  }
  return next;
}

/**
 * `entryId` の保留が、いま指定 `generation` の書き込みのままか（後続のドラッグに上書きされて
 * いないか）を判定する純関数。書き込みの settle 時に、その結果がユーザーの最終意図と一致する
 * （＝最新世代の書き込みだ）ときだけ通知/ロールバックするために使う。
 */
export function isLatestGeneration(
  pending: PendingMoves,
  entryId: string,
  generation: number,
): boolean {
  const current = pending.get(entryId);
  return current?.generation === generation;
}

/**
 * 失敗した書き込みのロールバックを純粋に計算する。**当該 entry の最新世代の書き込みが失敗した
 * ときだけ**保留を取り除く（古い世代の失敗では後続の新しい移動を巻き戻さない）。返り値の
 * `rolledBack` で「実際に巻き戻したか」を呼び出し側が判断し、巻き戻したときだけ失敗を通知できる
 *（巻き戻していないのに「元に戻しました」と誤報しない＝レビュー指摘）。
 */
export function rollbackFailedMove(
  pending: PendingMoves,
  entryId: string,
  generation: number,
): { pending: PendingMoves; rolledBack: boolean } {
  if (!isLatestGeneration(pending, entryId, generation)) {
    return { pending, rolledBack: false };
  }
  const next = new Map(pending);
  next.delete(entryId);
  return { pending: next, rolledBack: true };
}

/**
 * 指定 entry の保留を落とした**新しい** {@link PendingMoves} を返す（純関数・入力は破壊しない）。
 *
 * undo（トースト/コマンド）が frontmatter を移動前へ復元したのに楽観オーバーレイ（`pending`）が
 * 残ると、`reconcilePendingMoves` はサーバ値（復元後）が保留値（移動先）と一致せず（かつ in-flight でも
 * ないため）保留を落とせず、`applyPendingMoves` がカードを移動先象限へ描き続ける（ファイルは正しいのに
 * 表示が食い違う）。undo 起動時にこの純関数で該当保留を明示的に落とし、サーバ値の表示へ戻す（レビュー指摘）。
 * 該当 entry の保留が無ければ同じ Map を返す（不要な再描画を避ける）。
 */
export function dropPending(
  pending: PendingMoves,
  entryId: string,
): PendingMoves {
  if (!pending.has(entryId)) return pending;
  const next = new Map(pending);
  next.delete(entryId);
  return next;
}

/**
 * ドロップ先の目的両軸値が現在値と同一（＝同一象限への無駄打ち）かを判定する純関数。
 *
 * `handleDragEnd` の「既に同じ分類なら書き戻さない」no-op ガードを純化して単体テストで固定する
 *（同値なら `true`＝スキップ）。`current` が未知（保留にもサーバ entries にも無い）の場合は
 * `false`＝スキップしない（移動として扱う＝防御。存在しないカードを黙って握りつぶさない）。
 * `current` の軸は `boolean | undefined`（absent=未分類）を取りうるが、`target` は常に boolean
 *（4 象限の書き込み値）なので、未分類（undefined）からの移動は必ず不一致＝スキップされない。
 */
export function shouldSkipMove(
  current: { urgent: boolean | undefined; important: boolean | undefined } | undefined,
  target: { urgent: boolean; important: boolean },
): boolean {
  return (
    current !== undefined &&
    current.urgent === target.urgent &&
    current.important === target.important
  );
}

/** settle 時にスクリーンリーダーへ何を通知するか。 */
export type SettleAnnouncement = "success" | "failure" | "silent";

/**
 * 書き込みの settle 結果から aria-live への通知種別を決める純関数。
 *
 * `isLatest`（その書き込みが当該 entry の最新世代＝後続ドラッグに上書きされていないか）と
 * `failed` だけで決まる:
 * - 最新世代でない（superseded）→ 成否に関わらず `"silent"`（古い書き込みの結果を読み上げない／
 *   巻き戻していないのに「元に戻しました」と誤報しない）。
 * - 最新世代の失敗 → `"failure"`（実際にロールバックした＝`rollbackFailedMove` が巻き戻すケースと一致）。
 * - 最新世代の成功 → `"success"`。
 *
 * settle→通知の判断を純化して単体テストで固定する（コンポーネントの結線を細い switch に留める）。
 */
export function settleAnnouncement(
  failed: boolean,
  isLatest: boolean,
): SettleAnnouncement {
  if (!isLatest) return "silent";
  return failed ? "failure" : "success";
}

/** aria-live 通知の種別（`settleAnnouncement` の 3 種＋成功で undo 導線がある場合の派生）。 */
export type SettleAnnounceKind = "success" | "successUndoable" | "failure" | "silent";

/**
 * 書き込み settle 時に MatrixView が実行すべき副作用を 1 つの純関数へまとめた「実行計画」。
 *
 * `handleDragEnd` 内の settle は `callbacks.onMoveCard(...).then(()=>settle(false), ()=>settle(true))`
 * で成否から駆動されるが、その先の分岐（ロールバック要否・成功後の再突合・aria-live の文言種別・undo
 * トースト表示要否）は dnd-kit のドロップ確定が要り jsdom で駆動できず結線テストが困難だった（レビュー指摘 #2）。
 * そこで判断を本純関数へ切り出し（`settleAnnouncement` と同じ「決定を純化して細い実行に留める」流儀）、
 * 全分岐を単体で固定する。コンポーネント側の settle は本計画を機械的に実行するだけの薄い殻になる。
 */
export interface SettlePlan {
  /** 最新世代の失敗を巻き戻すか（古い世代の失敗では後続移動を巻き戻さない）。 */
  rollback: boolean;
  /** 成功後に保留を再突合するか（in-flight 中に先着した viewModel の確定漏れ解消・#4）。 */
  reconcile: boolean;
  /** aria-live へ読み上げる文言の種別（成功かつ undo 導線ありは successUndoable＝発見可能性を担保・#1）。 */
  announce: SettleAnnounceKind;
  /** 移動成功直後の「元に戻す」トーストを出すか（最新世代の成功かつ undo 配線時のみ）。 */
  showToast: boolean;
}

/**
 * settle の成否・最新世代か・undo 導線の有無から、MatrixView が実行する副作用計画を決める純関数。
 * - `rollback`: 最新世代の失敗のみ（`rollbackFailedMove` が実際に巻き戻すケースと一致）。
 * - `reconcile`: 成功時のみ（失敗はサーバ値≠保留で reconcile が落とさないため不要）。
 * - `announce`: `settleAnnouncement` を基に、成功かつ undo 導線ありは `successUndoable` へ格上げ。
 * - `showToast`: 最新世代の成功かつ undo 配線時のみ（superseded な古い成功ではトーストを出さない）。
 */
export function planSettle(
  failed: boolean,
  isLatest: boolean,
  hasUndo: boolean,
): SettlePlan {
  const base = settleAnnouncement(failed, isLatest);
  const succeeded = base === "success";
  return {
    rollback: failed && isLatest,
    reconcile: !failed,
    announce: succeeded ? (hasUndo ? "successUndoable" : "success") : base,
    showToast: succeeded && hasUndo,
  };
}
