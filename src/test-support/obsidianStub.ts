/**
 * vitest 用 obsidian ランタイムスタブ（**値だけ**を提供する。型は本物の `obsidian.d.ts` を使う）。
 *
 * obsidian npm パッケージは型定義のみでランタイム JS を持たない（実機が外部提供する）。
 * `readAxis.ts` が `import { NullValue } from "obsidian"` で**値**を参照するため、単体テストでは
 * `vitest.config.ts` がその値 import をこのスタブへ解決する（`import type` は消去されるので影響しない）。
 *
 * 実機検証（`scripts/e2e` の getValue プローブ）で確認した NullValue（軸 absent を表す）の事実を反映:
 * - absent は **singleton**（同一/別エントリの欠損値が `===` で同一オブジェクト）。
 * - `toString()` は **文字列 `"null"`**（JS `null` ではない）・`isTruthy()===false`。
 * ゆえに absent 判定は `toString()` の文字列ではなく **`instanceof NullValue`**（型同一性）で行う。
 *
 * ⚠️ 単体テストはこのスタブと本番が同じ NullValue を共有するため instanceof は恒真で、
 * 「スタブ＝実機」の同値性自体は単体では検証できない（#16 と同型の乖離退行を単体では捕捉不可）。
 * Obsidian の Value 表現が変わりうるバージョン更新時は `scripts/e2e` のプローブで実機表現を再確認すること。
 */
/** `getLanguage()` スタブ（実機はアプリ表示言語コードを返す。単体では既定 `"en"`）。 */
export function getLanguage(): string {
  return "en";
}

export class NullValue {
  toString(): string {
    return "null";
  }
  isTruthy(): boolean {
    return false;
  }
  /** 実機同様の singleton（`NullValue.value` が唯一のインスタンス）。 */
  static value = new NullValue();
}

/**
 * boolean 軸の値（実機 `BooleanValue extends PrimitiveValue<boolean>` 相当・#34）。
 * `readAxis.toAxisRaw` が `instanceof BooleanValue` を boolean 軸として振り分け、`interpretAxis` が
 * `isTruthy()` で配置側を決める（配置・非ロック＝#34 の挙動を #121 でも維持）。`readAxis.ts` が値 import する
 * 型はこのスタブへ解決される。⚠️ 単体では「スタブ＝実機の BooleanValue」の同値性は検証できない（`NullValue` と
 * 同型の限界。実機での `instanceof BooleanValue` 成立は `scripts/e2e` の placements 検証で担保する）。
 */
export class BooleanValue {
  constructor(private readonly value: boolean) {}
  toString(): string {
    return String(this.value);
  }
  isTruthy(): boolean {
    return this.value;
  }
}

/**
 * 数値軸の値（実機 `NumberValue extends PrimitiveValue<number>` 相当）。#121 v0.3-1a で数値しきい値軸の一次値に
 * なり、`readAxis.toAxisRaw` が公開 API `Number(toString())` で数値化し `interpretAxis` が `value >= threshold` で
 * 配置側を決める（1a では常に locked）。threshold 未設定の軸では未分類へ退避する（`instanceof BooleanValue` 不一致）。
 * `toString()` は数値文字列を返し `Number()` で読み戻せる（非有限も round-trip する）実機表現に合わせる。
 */
export class NumberValue {
  constructor(private readonly value: number) {}
  toString(): string {
    return String(this.value);
  }
  isTruthy(): boolean {
    return this.value !== 0;
  }
}

/**
 * 文字列軸の値（実機 `StringValue extends PrimitiveValue<string>` 相当・#34／#121 の型ガード検証用）。
 * boolean/数値いずれの軸 spec でも型不一致のため `readAxis` は未分類＋ロックへ倒す（`instanceof BooleanValue`
 * 不一致・`toAxisRaw` は string へ振り分け→boolean spec で locked）。select 軸（文字列 trueValue/falseValue）は
 * 後続 L2（#123）で正の許可リストへ引き上げる。
 */
export class StringValue {
  constructor(private readonly value: string) {}
  toString(): string {
    return this.value;
  }
  isTruthy(): boolean {
    return this.value.length > 0;
  }
}

/**
 * formula エラー等を表す値（実機 `ErrorValue` 相当・#121 v0.3-1a）。数値しきい値軸では
 * 「present だが解釈できない値」として**安全側でロック**（未分類＋ドラッグ不可）に落とす対象。
 * `readAxis.toAxisRaw` は既知の Value 型（Boolean/Number/String/Null）に一致しないものを一律
 * 「未対応＝ロック」に倒すため、本スタブは他の Value 型と `instanceof` で区別できれば足りる。
 * ⚠️ スタブ＝実機の同値性は単体では検証不能（`NullValue`/`NumberValue` と同型の限界。実機表現の
 * 追随は `scripts/e2e` のプローブで担保する）。
 */
export class ErrorValue {
  constructor(private readonly message: string = "error") {}
  toString(): string {
    return this.message;
  }
  isTruthy(): boolean {
    return false;
  }
}

/** タグ表記から先頭の `#` を 1 つ剥がして bare 名にする（`#urgent`→`urgent`・`urgent`→`urgent`）。 */
function toBareTag(raw: string): string {
  return raw.startsWith("#") ? raw.slice(1) : raw;
}

/**
 * タグ値（実機 `TagValue extends StringValue` 相当・#125 v0.3-3b）。frontmatter `tags` リストの 1 要素。
 * 実機は `constructor(value: string)`・`toString()` は値を verbatim で返す（StringValue 継承）。タグを Value 層で
 * `#` 前置（`#urgent`）で表すことがあり、`ListValue.includes` の loose-equals が `#`/大小差を吸収しうる
 *（要件 §9・実機確認事項）。本スタブは `toString()` を verbatim（実機 StringValue と同じ）にし、包含比較の
 * `#` 正規化は {@link ListValue.includes} 側に置く（決定論的・単体テスト可能）。⚠️ 実機 loose-equals の
 * `#`/大小 fold 同値性は単体では検証不能（`NullValue`/`BooleanValue` と同型の限界）＝`scripts/e2e` プローブで担保。
 */
export class TagValue {
  constructor(private readonly value: string) {}
  /** 実機 StringValue 同様に値を verbatim で返す（`new TagValue("urgent")`→`"urgent"`）。 */
  toString(): string {
    return this.value;
  }
  isTruthy(): boolean {
    return this.value.length > 0;
  }
}

/**
 * リスト値（実機 `ListValue extends NotNullValue` 相当・#125 v0.3-3b）。frontmatter の `tags`（配列プロパティ）。
 * `readAxis.readSingleAxisReading` が **`instanceof ListValue`** で振り分け、**ネイティブ
 * `includes(new TagValue(name))`**（`.data` を手パースしない）でタグ包含を判定する（AC1・要件 §9）。実機 API に
 * 合わせ `constructor(value)`・`includes(value): boolean`・`length()`・`get(index)`・`isTruthy()`・`toString()` を持つ。
 * `includes` は要素・引数を **bare 正規化**（`#` を剥がす）してから完全一致で比較する＝実機 loose-equals の
 * 「`#` 吸収」を決定論的に代役する（大小 fold は実機依存＝`scripts/e2e` で確認）。要素は文字列 or `Value`（`TagValue` 等）。
 */
export class ListValue {
  private readonly elements: readonly unknown[];
  constructor(value: readonly unknown[]) {
    this.elements = value;
  }
  /** 引数タグを bare 正規化して含むか（実機 loose-equals の代役＝`#` 吸収・exact case）。 */
  includes(target: unknown): boolean {
    const wanted = toBareTag(String(target));
    return this.elements.some((element) => toBareTag(String(element)) === wanted);
  }
  /** 要素数（実機 `length(): number`）。 */
  length(): number {
    return this.elements.length;
  }
  /** index の要素（実機は範囲外で `NullValue`。スタブは undefined を返す最小実装）。 */
  get(index: number): unknown {
    return this.elements[index];
  }
  isTruthy(): boolean {
    return this.elements.length > 0;
  }
}

/**
 * `Notice` スタブ（実機 `new Notice(message)` 相当）。実機はトーストを表示するが単体では
 * 描画できないため、生成メッセージを静的配列に記録して検証に使う（`runUndo` 等の Notice 経路を
 * アサートする）。テストは各ケース前に {@link Notice.reset} で初期化する。実機の `Notice` 型は
 * これらの静的メンバを持たないため、テストは本スタブを直接 import して静的アクセスする
 *（vitest は本番コードの `import { Notice } from "obsidian"` を同じ本クラスへ解決する）。
 */
export class Notice {
  static messages: string[] = [];
  static reset(): void {
    Notice.messages = [];
  }
  constructor(message: string) {
    Notice.messages.push(message);
  }
}

/**
 * `TFile` スタブ（`value instanceof TFile` 判定用の最小クラス）。実機 `TFile` は公開コンストラクタを
 * 持たないため、テストは本スタブで実インスタンスを生成し `getAbstractFileByPath` の返り値に使う
 *（本番コードの `import { TFile } from "obsidian"` と同一クラスへ解決されるため `instanceof` が成立する）。
 */
export class TFile {
  path: string;
  basename: string;
  extension: string;
  constructor(path = "", basename = "", extension = "md") {
    this.path = path;
    this.basename = basename;
    this.extension = extension;
  }
}
