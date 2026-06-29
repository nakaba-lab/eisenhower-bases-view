/**
 * アダプタ層 ↔ UI の境界契約（ViewModel）。
 *
 * この型は **Bases 非依存の plain データ**であり、`src/ui` はこの型にのみ依存する
 *（`obsidian`/Bases 型を import しない＝AC5 の疎結合を構造で保証）。
 * 軸値（urgent/important）や象限配置は #19（F2）で `MatrixEntry` に追加する。
 */

/** マトリクスに並ぶ 1 ノートの表示用データ。 */
export interface MatrixEntry {
  /** 安定キー（file.path）。 */
  id: string;
  /** 表示名（file.basename）。 */
  title: string;
}

/** ビューの描画状態。 */
export type MatrixState = "loading" | "empty" | "ready";

/** UI へ渡す ViewModel（アダプタ層が entries から組む）。 */
export interface MatrixViewModel {
  state: MatrixState;
  entries: MatrixEntry[];
}

/**
 * UI からアダプタ層へ委譲する操作のコールバック束。
 * F1（#18）では空。F3（#20）でドラッグ書き戻し、F5（#22）でカードを開く導線を足す。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MatrixCallbacks {}
