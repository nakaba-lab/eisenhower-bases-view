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
