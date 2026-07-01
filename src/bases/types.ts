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
  /**
   * 軸欠損ノートの未分類ゾーンを表示するか（設定 `showUnclassified` の反映）。
   * 省略時は表示（既定 true・後方互換）。`false` で UI は未分類ゾーンを描画しない。
   */
  showUnclassified?: boolean;
}

/** ドラッグ書き戻しで UI からアダプタへ渡す目的両軸値（両軸とも明示 boolean）。 */
export interface AxisWriteValues {
  urgent: boolean;
  important: boolean;
}

/**
 * UI からアダプタ層へ委譲する操作のコールバック束。
 * F1（#18）/F2（#19）では空。F3（#20）でドラッグ書き戻しを追加。F5（#22）でカードを開く/プレビュー導線を追加。
 */
export interface MatrixCallbacks {
  /**
   * カードを目的象限へ移動した結果を frontmatter に書き戻す（#20 F3）。
   *
   * UI は両軸の boolean だけを渡し、`TFile` 解決・`processFrontMatter`・失敗時の `Notice` は
   * アダプタ（`EisenhowerBasesView`）が担う（UI は `obsidian` 型に触れない＝AC5）。
   * 書き込み失敗時は reject し、UI 側は楽観移動をロールバックする。
   */
  onMoveCard?(entryId: string, axisValues: AxisWriteValues): Promise<void>;
  /**
   * カードのノートを開く（#22 F5・AC1/AC2/AC4）。
   *
   * UI は修飾キーから `newLeaf`（新タブ可否）を算出して渡すだけで、`file.path`（=entryId）からの
   * `TFile` 解決と `workspace.getLeaf(...).openFile(...)` はアダプタが担う（UI は `obsidian` 型に触れない＝AC5）。
   */
  onOpenCard?(entryId: string, opts: { newLeaf: boolean }): void;
  /**
   * カードのホバーでページプレビューを起動する（#22 F5・AC3）。
   *
   * アダプタが core page-preview を `app.workspace.trigger("hover-link", …)` で発火する
   *（実際に表示するかはユーザーのコア「ページプレビュー」設定に委ねる）。
   * `targetEl` はプレビュー位置決めに使うカード要素、`event` は発火元のマウスイベント。
   */
  onHoverCard?(entryId: string, targetEl: HTMLElement, event: MouseEvent): void;
}
