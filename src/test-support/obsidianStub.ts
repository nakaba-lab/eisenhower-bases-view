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
