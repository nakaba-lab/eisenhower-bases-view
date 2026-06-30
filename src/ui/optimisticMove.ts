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

/** 全象限から id 一致のエントリを探して返す（無ければ undefined）。 */
function findEntry(
  placements: QuadrantPlacements,
  id: string,
): MatrixEntry | undefined {
  for (const key of QUADRANT_KEYS) {
    const found = placements[key].find((e) => e.id === id);
    if (found) return found;
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
    const current = findEntry(next, id);
    if (!current) continue;
    // 現在の象限から取り除く。
    for (const key of QUADRANT_KEYS) {
      const idx = next[key].findIndex((e) => e.id === id);
      if (idx !== -1) {
        next[key].splice(idx, 1);
        break;
      }
    }
    // 両軸値を上書きしたエントリを目的象限へ。
    const moved: MatrixEntry = {
      ...current,
      urgent: axis.urgent,
      important: axis.important,
    };
    const target = classifyQuadrant(axis);
    next[target].push(moved);
  }
  return next;
}

/**
 * サーバ値（最新 entries）と突合し、**確定済み（サーバが保留値に追いついた）**または
 * **消滅した**保留を落とした新しい {@link PendingMoves} を返す（純関数）。
 *
 * 書き込み成功 → `onDataUpdated` 再描画で entries が更新された後に呼び、楽観オーバーレイを
 * 解除する。まだ追いついていない保留は残す（書き込み in-flight）。
 */
export function reconcilePendingMoves(
  pending: PendingMoves,
  entries: readonly MatrixEntry[],
): PendingMoves {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const next: PendingMoves = new Map();
  for (const [id, axis] of pending) {
    const entry = byId.get(id);
    if (!entry) continue; // サーバから消えた → 保留破棄
    const confirmed =
      entry.urgent === axis.urgent && entry.important === axis.important;
    if (!confirmed) next.set(id, axis); // まだ反映前 → 残す
  }
  return next;
}
