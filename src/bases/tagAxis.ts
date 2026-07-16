/**
 * タグ軸（#125 v0.3-3b）の per-axis tagName 解決（ビュー options 主 + 設定既定＝ハイブリッド）。
 *
 * 数値しきい値（`numberThreshold`）・軸プロパティ（#21）・滞留しきい値（#106）と同じハイブリッド:
 * ビュー options（`config.get(KEY)`）を主とし、未設定・空なら設定既定（`defaultUrgencyTag`／
 * `defaultImportanceTag`）へフォールバックする。タグ軸は**明示の tagName が必須**（数値の threshold と違い、
 * 配列プロパティ `tags` は常に配列で値型から kind を推論できない）ため、tagName の有無が「その軸をタグ軸として
 * 扱うか」の唯一のスイッチになる（tagName あり → タグ軸・kind 優先順位は tag > number > boolean）。
 *
 * tagName は **bare 形**（`#` 無し・`urgent`）で解決する: 読み取り側は `new TagValue(name)` を組み `ListValue.
 * includes` で包含判定し、書き戻し側は frontmatter の bare 配列に add/remove する。Value 層は `#urgent` と
 * `#` 前置だが、設定/frontmatter は bare のため、入力の `#` は {@link toTagName} が剥がす（`#`/大小の実機
 * 吸収は要件 §9 の実機確認事項）。GUI コントロールは数値しきい値 v0.3-1a と同型で未登録（`.base` の view
 * config に手で置けば効く。タグ選択 UI の実機スパイク後に別途）。設計は `docs/design/bases.md`「タグ軸」節。
 *
 * `config.get` は churn 対象の Bases API 接触点のため、`numberThreshold.safeGetOption` と対称に try/catch で
 * throw を境界退避し、ビュー全体の再描画を壊さず設定既定へ倒す。
 */
import type { EisenhowerSettings } from "../settings";
import { logChurnFailureOnce } from "./readAxis";

/**
 * Bases ビュー options のキー（タグ名・緊急度／重要度）。本層は `config.get(key)` で `.base` の
 * view config が持つ値を読み、未設定なら設定タブのグローバル既定へフォールバックする（軸プロパティ・
 * 数値しきい値と対称）。
 */
export const URGENT_TAG_OPTION_KEY = "urgentTag";
export const IMPORTANT_TAG_OPTION_KEY = "importantTag";

/** 解決済みの per-axis tagName（bare 形）。`null` は当該軸のタグ軸オフ（未設定）。 */
export interface TagNames {
  urgent: string | null;
  important: string | null;
}

/** `config.get` だけを要求する最小形（テスト・呼び出し側が部分実装を渡せるように緩める）。 */
type ConfigLike = { get?(key: string): unknown } | null | undefined;

/**
 * 生値（options 由来・設定文字列）を bare tagName へ正規化する（不正・未設定は `null`）。
 * 前後空白をトリムし、先頭の `#`（Value 層の `#urgent` 表記・手入力）を 1 つ剥がして bare 名にする。
 * 空文字・空白のみ・`#` のみ・非文字列は `null`（呼び出し側が「タグ軸オフ」に倒す）。設定読込側
 *（`settings.mergeTagString`）は string 化のみを担い、**`#` 剥がし・空判定はここに一本化**する。
 */
export function toTagName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const bare = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  return bare === "" ? null : bare;
}

/** 既にログ済みの失敗 option キー（`logChurnFailureOnce` が再描画毎の多重ログを間引く）。 */
const loggedGetOptionFailures = new Set<string>();

/** `config.get(key)` を **throw させない**境界防御でくるむ（`numberThreshold.safeGetOption` と対称・churn 耐性）。 */
function safeGetOption(config: ConfigLike, key: string): unknown {
  if (config == null || typeof config.get !== "function") return undefined;
  try {
    return config.get(key);
  } catch (error) {
    logChurnFailureOnce(
      loggedGetOptionFailures,
      key,
      "config.get failed; using default tag name",
      error,
    );
    return undefined;
  }
}

/**
 * 両軸の tagName を解決する。ビュー options を主とし、未設定・空なら設定既定へフォールバックする。
 * 返り値の `null` は当該軸のタグ軸オフ（読み取り側は当該軸をタグ軸として扱わず、数値/boolean 経路へ倒す）。
 */
export function resolveTagNames(
  config: ConfigLike,
  settings: EisenhowerSettings,
): TagNames {
  return {
    urgent:
      toTagName(safeGetOption(config, URGENT_TAG_OPTION_KEY)) ??
      toTagName(settings.defaultUrgencyTag),
    important:
      toTagName(safeGetOption(config, IMPORTANT_TAG_OPTION_KEY)) ??
      toTagName(settings.defaultImportanceTag),
  };
}
