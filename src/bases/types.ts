/**
 * アダプタ層 ↔ UI の境界契約（ViewModel）。
 *
 * この型は **Bases 非依存の plain データ**であり、`src/ui` はこの型にのみ依存する
 *（`obsidian`/Bases 型を import しない＝AC5 の疎結合を構造で保証）。
 * 象限キー（{@link Quadrant}）は純ロジック `src/logic/quadrant` を真実源とする。
 */
import type { Quadrant } from "../logic/quadrant";

/** マトリクスに並ぶ 1 ノートの表示用データ。 */
export interface MatrixEntry {
  /** 安定キー（file.path）。 */
  id: string;
  /** 表示名（file.basename）。 */
  title: string;
  /** 緊急度軸の値（absent は undefined＝false と区別）。 */
  urgent: boolean | undefined;
  /** 重要度軸の値（absent は undefined＝false と区別）。 */
  important: boolean | undefined;
}

/** ビューの描画状態。 */
export type MatrixState = "loading" | "empty" | "ready";

/**
 * 象限ごとに振り分けたエントリ（アダプタが事前グルーピング＝#19）。
 * UI はこの構造をそのまま描画し、グルーピング/件数判定を持たない。
 */
export type QuadrantPlacements = Record<Quadrant, MatrixEntry[]>;

/** UI へ渡す ViewModel（アダプタ層が entries から組む）。 */
export interface MatrixViewModel {
  state: MatrixState;
  /** 全エントリのフラットな一覧（合計・後方互換）。 */
  entries: MatrixEntry[];
  /** 4 象限＋未分類への事前グルーピング（#19）。 */
  placements: QuadrantPlacements;
}

/**
 * UI からアダプタ層へ委譲する操作のコールバック束。
 * F1（#18）/F2（#19）では空。F3（#20）でドラッグ書き戻し、F5（#22）でカードを開く導線を足す。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MatrixCallbacks {}
