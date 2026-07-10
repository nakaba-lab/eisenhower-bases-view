/**
 * アダプタ層 ↔ UI の境界契約（ViewModel）。
 *
 * この型は **Bases 非依存の plain データ**であり、`src/ui` はこの型にのみ依存する
 *（`obsidian`/Bases 型を import しない＝AC5 の疎結合を構造で保証）。
 * 象限キー（{@link Quadrant}）は純ロジック `src/logic/quadrant` を真実源とする。
 */
import type { Quadrant, QuadrantKey } from "../logic/quadrant";
import type { Messages } from "../i18n";
import type { Badge } from "./readBadges";

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
  /**
   * ドラッグ不可（`true` のときのみ設定）。書込可能 `note.*` 軸に**非 boolean 値**（数値/文字列）を
   * 持つカードで、ドロップの両軸 `true/false` 上書きで元値を破壊するため未分類ゾーンでも掴ませない
   *（#34 の未分類化で塞げなかった手動ドラッグ経路の封鎖）。absent（欠損）のカードは付かない＝分類可。
   */
  locked?: boolean;
  /**
   * カード追加プロパティの読み取り専用バッジ（#104 F7）。アダプタ（`toViewModel`）が解決済みの
   * `{ label, text, emphasized? }` を載せ、`NoteCard` が控えめに描画する。表示 0 個（既定）では省略する。
   */
  badges?: Badge[];
}

/** ビューの描画状態。 */
export type MatrixState = "loading" | "empty" | "ready";

/**
 * 象限ごとに振り分けたエントリ（アダプタが事前グルーピング＝#19）。
 * UI はこの構造をそのまま描画し、グルーピング/件数判定を持たない。
 */
export type QuadrantPlacements = Record<Quadrant, MatrixEntry[]>;

/**
 * UI へ渡す表示情報（象限ラベル/色・言語文言）を束ねたもの（#23 F6）。
 * アダプタ層が設定（カスタムラベル/色）と言語メッセージ（既定ラベル）を解決して組む
 *（`resolvePresentation`）。UI はこの解決済みデータを描画するだけで、`language` を知らない。
 */
export interface MatrixPresentation {
  /** 解決済みの言語メッセージ束（静的文言・軸ラベル・SR・アナウンステンプレート）。 */
  messages: Messages;
  /** 表示する象限ラベル（カスタム || 言語既定）。 */
  quadrantLabels: Record<QuadrantKey, string>;
  /** 象限アクセント色（カスタム hex。空文字＝テーマ既定にフォールバック）。 */
  quadrantColors: Record<QuadrantKey, string>;
}

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
  /**
   * ラベル/色/言語文言の表示情報（#23 F6）。省略時は UI が現行の既定（英ラベル＋日本語文言）に
   * フォールバックする（後方互換）。アダプタは常に載せる。
   */
  presentation?: MatrixPresentation;
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
  onOpenCard?: (entryId: string, opts: { newLeaf: boolean }) => void;
  /**
   * カードのホバーでページプレビューを起動する（#22 F5・AC3）。
   *
   * アダプタが core page-preview を `app.workspace.trigger("hover-link", …)` で発火する
   *（実際に表示するかはユーザーのコア「ページプレビュー」設定に委ねる）。
   * `targetEl` はプレビュー位置決めに使うカード要素、`event` は発火元のマウスイベント。
   */
  onHoverCard?: (entryId: string, targetEl: HTMLElement, event: MouseEvent) => void;
  /**
   * 直前 1 手の移動を元に戻す（undo・最小実装）。
   *
   * ビュー内の「元に戻す」トースト（{@link MatrixViewModel} 描画側）とコマンドの双方がこれを起動する。
   * frontmatter 復元（present は代入・absent は delete）・「直前 1 手」の保持はアダプタ
   *（`EisenhowerBasesView`／`UndoManager`）が担う（`onMoveCard` と同じ疎結合＝AC5）。元に戻せる移動が
   * 無ければアダプタが `Notice` を出す。
   *
   * `expectedEntryId` を渡すと、**現在の記録がその entry の移動である場合のみ**戻す（トーストが特定
   * ノートを名指しするため、複数ビュー併用で記録が別の移動に置き換わっていたら誤って別ノートを戻さない
   * ようにするガード）。省略時（コマンド起動）は「直前 1 手」を無条件に戻す。
   *
   * （arrow 型プロパティで宣言する＝`onOpenCard`/`onHoverCard` と同様。存在チェックを `Boolean(...)` 等へ
   * 渡しても unbound-method を誘発しないため。）
   */
  onUndoMove?: (expectedEntryId?: string) => void;
  /**
   * ビュー内の楽観オーバーレイ（pending）を `entryId` 単位で落とす関数をアダプタへ登録する（レビュー指摘 #6）。
   *
   * トースト経由の undo は UI 内で直接 `dropPending` できるが、**コマンドパレット経由の undo はこの
   * コンポーネントを経由しない**ため、書込成功直後の在庫レース窓で残った pending を落とせず、frontmatter は
   * 戻ったのにカードが誤象限へ貼り付く（トースト経路との非対称）。UI はマウント時に「pending を落とす」関数を
   * 登録し（アンマウント時は `null` で解除）、アダプタ（`EisenhowerBasesView`）がコマンド undo 後にこれを
   * 呼んで表示をサーバ値へ戻す。UI は `obsidian` 型に触れず、`app`/コマンド接触はアダプタに閉じる（AC5）。
   */
  registerPendingDropper?: (drop: ((entryId: string) => void) | null) => void;
}
