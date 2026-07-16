/**
 * 直前 1 手の操作を「元に戻す」ための純ロジック（Obsidian 非依存・単体 TDD の対象）。
 *
 * ドラッグ書き戻し（#20 F3）は両軸を `true/false` で上書きする破壊的操作、完了トグル（#105 F10）は
 * 単一の完了キーを上書きする破壊的操作のため、操作前の frontmatter 値を捕捉しておき、undo で復元する。
 * 復元は **完全復元**（present は値を代入、absent はキーを delete して元へ戻す）で、`delete` は
 * **この undo 経路のみ**に閉じる（分類ドラッグ・完了書き込みは引き続き delete しない＝v1 の boolean
 * 軸限定制約を崩さない）。
 *
 * #105 で記録形式を 2 軸固定形（`{urgent, important}`）から **キーリスト形（`entries: UndoEntry[]`）**
 * へ一般化した。ドラッグ書き戻し＝2 要素・完了トグル＝1 要素が同じ機構（前値 verbatim 捕捉＋値照合＋
 * 1 手保持）を共有する（型だけ一般化。思想は不変）。
 *
 * 値は boolean に限定せず **verbatim（生値）で保持**する。非 boolean（数値/文字列）の `note.*`
 * キーを持つカードに万一書き込みが起きても、undo で元の値をそのまま戻せるようにしてデータ破壊を残さない
 *（#34 の型ガードは「並べない/無効化」で守るが、万一の書き込みも undo で可逆に保つ）。
 *
 * トリガー（コマンド／ビュー内トースト）と実際の `processFrontMatter` 適用はアダプタ層が担い、
 * 本モジュールは「何を捕捉し、どう復元するか」の純粋な判定だけを提供する。
 */

/**
 * frontmatter キー 1 つの「操作前の値」。キー欠損（absent）と、値を持つ（present）を区別する。
 * absent は復元時に delete、present は値を代入して戻す。
 */
export type PreviousAxisValue =
  | { readonly present: false }
  | { readonly present: true; readonly value: unknown };

/**
 * 記録した 1 キーの undo 情報（#105 でキーリスト化）。書き戻し先キー・操作前の値・書き込んだ値
 *（同一性照合用）を持つ。
 */
export interface UndoEntry {
  /** 書き戻したキー（復元先の frontmatter キー）。 */
  key: string;
  /** 操作前の値（absent は復元で delete）。 */
  previous: PreviousAxisValue;
  /**
   * 操作で書き込んだ値（同一性照合用）。undo は `entryId`（file.path）でノートを再解決するため、
   * 操作後にそのパスが**別ノートで再利用**されていたり、ユーザー/他プラグインがキー値を書き換えて
   * いた場合、記録した `previous` を適用すると無関係な値を上書き/`delete` しうる（undo は唯一の delete
   * 経路）。復元前に「全キーが自分の書いた値のままか」を {@link isUndoApplicable} で照合するために保持する。
   * boolean に限らず verbatim（`unknown`）で持つ（将来の数値軸 #88 に備える）。
   */
  wrote: unknown;
}

/** 直前 1 手の操作を元に戻すための記録（1 個以上の {@link UndoEntry} の集合）。 */
export interface UndoRecord {
  /** 対象ノート（file.path）。復元時に TFile を解決する安定キー。 */
  entryId: string;
  /** 表示名（file.basename）。トースト/通知の文言に使う。 */
  title: string;
  /** 書き戻した各キーの undo 情報（ドラッグ書き戻し＝2 要素・完了トグル＝1 要素）。 */
  entries: UndoEntry[];
}

/** frontmatter 風オブジェクト（obsidian の `processFrontMatter` が渡す plain object の最小型）。 */
export type FrontmatterLike = Record<string, unknown>;

/**
 * frontmatter の 1 キーの現在値を「操作前の値」として捕捉する（書き戻しで上書きする前に呼ぶ）。
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

/** 1 キーへの書き込み（キーと書き込む値）。{@link buildUndoEntries} の入力。 */
export interface AxisWrite {
  key: string;
  value: unknown;
}

/**
 * 書き込み前に各キーの操作前の値を捕捉し、書き込む値（`wrote`）と対にして {@link UndoEntry} 群を組む
 *（#105 の一般化）。ドラッグ書き戻しは 2 キー（urgent/important）、完了トグルは 1 キー（完了キー）を渡す。
 * 呼び出し側（`writeBackAxes`／`writeCompletion`）はこの結果で `UndoRecord` を作り、続けて `frontmatter`
 * へ実際の書き込みを行う。
 */
export function buildUndoEntries(
  frontmatter: FrontmatterLike,
  writes: readonly AxisWrite[],
): UndoEntry[] {
  return writes.map((write) => ({
    key: write.key,
    previous: capturePreviousValue(frontmatter, write.key),
    wrote: write.value,
  }));
}

/** 1 キーを記録した操作前の値へ復元する（present は代入、absent は delete）。 */
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
 * 記録した操作前の値へ frontmatter を復元する（引数オブジェクトを mutate する）。
 * present の各キーは値を代入し、absent のキーは delete して元（未分類/未完了）へ戻す（完全復元）。
 */
export function applyUndo(frontmatter: FrontmatterLike, record: UndoRecord): void {
  for (const entry of record.entries) {
    restoreKey(frontmatter, entry.key, entry.previous);
  }
}

/**
 * 記録した書込値と現在値が同一かを判定する（#125 AC4 で配列＝タグ軸に対応）。
 *
 * プリミティブ（boolean/number/string 等）は `===`（参照＝値）で足りるが、**タグ軸の書き戻しは
 * frontmatter の `tags` 配列を add/remove した新配列を書く**ため、`processFrontMatter` の round-trip 後の
 * `frontmatter[key]` は記録した `wrote` とは**別オブジェクト**になり `===` が常に不一致になる（undo が
 * 一度も適用されない）。よって**両辺とも配列のときだけ要素単位の値等価**（長さ＋各要素 `===`）で比較し、
 * それ以外は従来どおり `===`（プリミティブ回帰・型が変わった場合は不一致）。tagName は文字列のため要素の
 * 浅い `===` で足りる（ネストした配列/オブジェクトの深い等価は tags 軸では発生しない）。
 */
function isSameWrittenValue(current: unknown, wrote: unknown): boolean {
  if (Array.isArray(current) && Array.isArray(wrote)) {
    return (
      current.length === wrote.length &&
      current.every((element, index) => element === wrote[index])
    );
  }
  return current === wrote;
}

/**
 * 記録した「書き込んだ値」（各 {@link UndoEntry.wrote}）がいまも全キーに残っているか
 *（＝この記録が指すノートが、記録時に自分が書き込んだ状態のままか）を判定する純関数。
 *
 * undo は file.path でノートを再解決するため、操作後にそのパスが別ノートで再利用されていたり、
 * ユーザー/他プラグインがキー値を書き換えていた場合、記録した `previous` を適用すると無関係な値を
 * 上書き/`delete` しうる（undo は唯一の delete 経路のため影響が大きい）。適用前に本判定で「全キーが
 * 自分の書いた値のままか」を照合し、一つでも不一致なら復元しない（呼び出し側は記録を破棄する）。
 * 配列（タグ軸）は値等価で照合する（{@link isSameWrittenValue}・#125 AC4）。
 */
export function isUndoApplicable(
  frontmatter: FrontmatterLike,
  record: UndoRecord,
): boolean {
  return record.entries.every((entry) =>
    isSameWrittenValue(frontmatter[entry.key], entry.wrote),
  );
}

/**
 * 「直前 1 手」だけを保持する undo の状態ホルダ（純粋・単体テスト対象）。
 *
 * 最小実装のため redo・多段 undo は持たない。新しい操作が来たら前の記録を上書きし
 *（`record`）、undo 実行後は `clear` で空にする。コマンド（プラグイン全体）とビュー内トーストの
 * 双方がこの単一の記録を共有し、「直前の操作」を一意に指す。
 */
export class UndoManager {
  private current: UndoRecord | null = null;

  /** 直前の操作を記録する（既存の記録は上書きされる＝保持は 1 手のみ）。 */
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

  /**
   * 現在の記録が指すノート（`entryId`＝file.path）が引数の path、**またはその配下**なら記録を破棄する。
   *
   * 記録した path のファイルが **削除/リネーム**されると、その path は別ノートで再利用されうる。
   * undo は path でノートを再解決するため、記録を残したままだと再利用された別ノートを誤って
   * 上書き/`delete` しうる（`isUndoApplicable` の値照合だけでは、同一象限＝同じ boolean 値を持つ
   * 別ノートを区別できない）。vault の delete/rename イベントで本メソッドを呼び、path が無効化された
   * 時点で記録を捨てて「パス再利用への undo」を根本から断つ（`main.ts` が配線・レビュー指摘）。
   *
   * **フォルダ対応**: Obsidian はフォルダの delete/rename を**フォルダ 1 件のイベント**として発火し、
   * 配下ファイルごとには発火しない。よって完全一致（ファイル自体）に加え、記録 path が `entryId + "/"`
   * で始まる（＝削除/リネームされたフォルダの配下）場合も破棄し、親フォルダ操作での取り残しを防ぐ
   *（Gemini レビュー指摘。`Folder` 削除 → `Folder/Note.md` の記録を破棄）。
   * 破棄したら `true`、対象外（記録が無い/無関係な path）なら `false` を返す。
   */
  clearIfEntry(entryId: string): boolean {
    const current = this.current?.entryId;
    if (current === undefined) return false;
    if (current !== entryId && !current.startsWith(`${entryId}/`)) return false;
    this.current = null;
    return true;
  }

  /** 元に戻せる操作があるか。 */
  hasRecord(): boolean {
    return this.current !== null;
  }
}
