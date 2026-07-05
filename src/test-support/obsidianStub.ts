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
 * v1 は boolean 軸限定のため、`readAxis.normalizeAxis` は **`instanceof BooleanValue` の値だけ**
 * を `isTruthy()` で boolean 化する。`readAxis.ts` が値 import する型はこのスタブへ解決される。
 * ⚠️ 単体では「スタブ＝実機の BooleanValue」の同値性は検証できない（`NullValue` と同型の限界。
 * 実機での `instanceof BooleanValue` 成立は `scripts/e2e` の placements 検証で担保する）。
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
 * 数値軸の値（実機 `NumberValue extends PrimitiveValue<number>` 相当・#34 の型ガード検証用）。
 * v1 boolean 軸限定では非 boolean のため未分類へ退避される（`instanceof BooleanValue` に一致しない）。
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
 * 文字列軸の値（実機 `StringValue extends PrimitiveValue<string>` 相当・#34 の型ガード検証用）。
 * v1 boolean 軸限定では非 boolean のため未分類へ退避される（`instanceof BooleanValue` に一致しない）。
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
