/**
 * 直前 1 手の移動を「元に戻す」ための純ロジック（Obsidian 非依存・単体 TDD の対象）。
 *
 * ドラッグ書き戻し（#20 F3）は両軸を `true/false` で上書きする破壊的操作のため、移動前の
 * frontmatter 値を捕捉しておき、undo で復元する。復元は **完全復元**（present は値を代入、
 * absent はキーを delete して未分類へ戻す）で、`delete` は **この undo 経路のみ**に閉じる
 *（分類ドラッグは引き続き delete しない＝v1 の boolean 軸限定制約を崩さない）。
 *
 * 値は boolean に限定せず **verbatim（生値）で保持**する。非 boolean（数値/文字列）の `note.*`
 * 軸を持つ未分類カードを象限へドラッグした場合でも、undo で元の値をそのまま戻せるようにして
 * データ破壊を残さない（#34 の型ガードは「並べない」で守るが、万一の書き込みも undo で可逆に保つ）。
 *
 * トリガー（コマンド／ビュー内トースト）と実際の `processFrontMatter` 適用はアダプタ層が担い、
 * 本モジュールは「何を捕捉し、どう復元するか」の純粋な判定だけを提供する。
 */

/**
 * frontmatter キー 1 つの「移動前の値」。キー欠損（absent）と、値を持つ（present）を区別する。
 * absent は復元時に delete、present は値を代入して戻す。
 */
export type PreviousAxisValue =
  | { readonly present: false }
  | { readonly present: true; readonly value: unknown };

/** 書き戻し先の frontmatter キー（両軸）。 */
export interface UndoAxisKeys {
  urgent: string;
  important: string;
}

/** 直前 1 手の移動を元に戻すための記録。 */
export interface UndoRecord {
  /** 対象ノート（file.path）。復元時に TFile を解決する安定キー。 */
  entryId: string;
  /** 表示名（file.basename）。トースト/通知の文言に使う。 */
  title: string;
  /** 書き戻したキー（復元先）。 */
  keys: UndoAxisKeys;
  /** 各軸の移動前の値（absent は delete で復元）。 */
  previous: { urgent: PreviousAxisValue; important: PreviousAxisValue };
}

/** frontmatter 風オブジェクト（obsidian の `processFrontMatter` が渡す plain object の最小型）。 */
export type FrontmatterLike = Record<string, unknown>;

/**
 * frontmatter の 1 キーの現在値を「移動前の値」として捕捉する（書き戻しで上書きする前に呼ぶ）。
 *
 * キーが存在しなければ absent（`present:false`）、存在すれば値を verbatim で保持する。
 * 値が `undefined` でもキーが存在すれば present とみなす（`hasOwnProperty` で判定。
 * `frontmatter[key] === undefined` では absent と `undefined` 値を区別できないため）。
 */
export function capturePreviousValue(
  frontmatter: FrontmatterLike,
  key: string,
): PreviousAxisValue {
  if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
    return { present: true, value: frontmatter[key] };
  }
  return { present: false };
}

/** 両軸の移動前の値を捕捉する（{@link capturePreviousValue} を両軸へ）。 */
export function capturePreviousAxes(
  frontmatter: FrontmatterLike,
  keys: UndoAxisKeys,
): UndoRecord["previous"] {
  return {
    urgent: capturePreviousValue(frontmatter, keys.urgent),
    important: capturePreviousValue(frontmatter, keys.important),
  };
}

/** 1 キーを記録した移動前の値へ復元する（present は代入、absent は delete）。 */
function restoreKey(
  frontmatter: FrontmatterLike,
  key: string,
  previous: PreviousAxisValue,
): void {
  if (previous.present) {
    frontmatter[key] = previous.value;
  } else {
    delete frontmatter[key];
  }
}

/**
 * 記録した移動前の値へ frontmatter を復元する（引数オブジェクトを mutate する）。
 * present の軸は値を代入し、absent の軸はキーを delete して未分類（absent）へ戻す（完全復元）。
 */
export function applyUndo(frontmatter: FrontmatterLike, record: UndoRecord): void {
  restoreKey(frontmatter, record.keys.urgent, record.previous.urgent);
  restoreKey(frontmatter, record.keys.important, record.previous.important);
}

/**
 * 「直前 1 手」だけを保持する undo の状態ホルダ（純粋・単体テスト対象）。
 *
 * 最小実装のため redo・多段 undo は持たない。新しい移動が来たら前の記録を上書きし
 *（`record`）、undo 実行後は `clear` で空にする。コマンド（プラグイン全体）とビュー内トーストの
 * 双方がこの単一の記録を共有し、「直前の移動」を一意に指す。
 */
export class UndoManager {
  private current: UndoRecord | null = null;

  /** 直前の移動を記録する（既存の記録は上書きされる＝保持は 1 手のみ）。 */
  record(record: UndoRecord): void {
    this.current = record;
  }

  /** 現在の記録を返す（無ければ null）。消費はしない。 */
  peek(): UndoRecord | null {
    return this.current;
  }

  /** 記録を空にする（undo 実行後・ビュー破棄時など）。 */
  clear(): void {
    this.current = null;
  }

  /** 元に戻せる移動があるか。 */
  hasRecord(): boolean {
    return this.current !== null;
  }
}
