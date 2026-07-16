/**
 * 選択（select）軸（#123 v0.3-2）の per-axis 選択値解決（ビュー options 主 + 設定既定＝ハイブリッド）。
 *
 * 数値しきい値軸（`numberThreshold.ts`）と対称のハイブリッド: ビュー options（`config.get(KEY)`）を主とし、
 * 未設定なら設定既定（`defaultUrgencySelectTrueValue` 等）へフォールバックする。Base ごとに真偽の語彙が
 * 違う（例: `status: done/todo`／`priority: high/low`）ため per-axis で持つ。
 *
 * **「選択軸オン」の条件**: `trueValue` と `falseValue` が**両方とも非空**かつ**互いに異なる**ときだけ
 * 当該軸の {@link SelectValues} を返し、それ以外は `null`（＝選択軸オフ＝当該軸は v1 の boolean 軸挙動を維持）。
 * 同値は二値軸として成立しない（後勝ちで潰れる設定ミス）ため `null`。off-sentinel を `null` で表すことで、
 * v0.3 アップグレード時に既存の文字列 `note.*` が不意に象限へ現れる驚きを防ぐ（数値軸の off-sentinel と同じ思想）。
 *
 * `config.get` は churn 対象の Bases API 接触点のため、`numberThreshold.safeGetOption` と対称に try/catch で
 * throw を境界退避し、ビュー全体の再描画を壊さず設定既定へ倒す。純ロジックの `select` 解釈/書き戻しは #120 で
 * 実装済み（`interpretAxis`／`planAxisWrite`）で、本モジュールはその spec を供給する配線のみを担う。
 * 設計は `docs/design/bases.md`「選択（select）軸アダプタ配線」。
 */
import type { EisenhowerSettings } from "../settings";
import { logChurnFailureOnce } from "./readAxis";

/**
 * Bases ビュー options のキー（選択軸・緊急度／重要度の true 値／false 値）。本層は `config.get(key)` で
 * `.base` の view config が持つ値を読み、未設定なら設定タブのグローバル既定へフォールバックする
 * （軸プロパティ・数値しきい値と対称）。
 */
export const URGENT_SELECT_TRUE_OPTION_KEY = "urgentSelectTrueValue";
export const URGENT_SELECT_FALSE_OPTION_KEY = "urgentSelectFalseValue";
export const IMPORTANT_SELECT_TRUE_OPTION_KEY = "importantSelectTrueValue";
export const IMPORTANT_SELECT_FALSE_OPTION_KEY = "importantSelectFalseValue";

/** 解決済みの選択軸の 2 値（`trueValue`＝true 側 / `falseValue`＝false 側の代表文字列）。 */
export interface SelectValues {
  trueValue: string;
  falseValue: string;
}

/** 両軸の選択値。`null` は当該軸の選択軸オフ（未設定・同値）。 */
export interface AxisSelectValues {
  urgent: SelectValues | null;
  important: SelectValues | null;
}

/** `config.get` だけを要求する最小形（テスト・呼び出し側が部分実装を渡せるように緩める）。 */
type ConfigLike = { get?(key: string): unknown } | null | undefined;

/**
 * 生値（options 由来・設定文字列）を選択値へ正規化する。文字列は前後トリムし、空文字・空白のみ・非文字列・
 * null/undefined は `null`（当該値は「未設定」）。数値しきい値の `toNumberThreshold` と同型で、設定読込側は
 * string 化のみを担い、解釈（トリム・空判定）はここに一本化する。
 */
export function normalizeSelectValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 両値を {@link SelectValues} へまとめる（**両方非 null かつ互いに異なる**ときだけ成立）。片方でも未設定
 * （`null`）なら二値軸として成立しないため `null`。同値は同一キーへ後勝ちで潰れる設定ミスのため `null`。
 */
export function toSelectValues(
  trueValue: string | null,
  falseValue: string | null,
): SelectValues | null {
  if (trueValue === null || falseValue === null) return null;
  if (trueValue === falseValue) return null;
  return { trueValue, falseValue };
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
      "config.get failed; using default select values",
      error,
    );
    return undefined;
  }
}

/**
 * 1 軸の選択値を解決する（options 主・設定既定フォールバック・両値非空かつ異なるときだけ成立）。
 *
 * **pair をアトミックに解決する**（数値しきい値の写しだが、select は 2 値の**結合ペア**である点が違う・レビュー指摘）:
 * ビュー options が `trueValue`／`falseValue` の**どちらか一方でも**指定していれば、その軸は「ビューが独自の
 * 語彙を定義した」とみなし**ビューの pair をそのまま**採る（未設定の片側を設定既定から借りて別語彙を混ぜない）。
 * options が両方とも未設定のときだけ**設定既定の pair 全体**へフォールバックする。これにより、ビューが片側だけ
 * 指定したときに設定既定のトークンを混入させて {done, low} のような混成 pair を作る（→ 越境ドロップで意図しない
 * グローバル値を frontmatter へ書く／ビュー値が設定既定値と一致して無言でオフになる）事故を防ぐ。片側だけの
 * 不完全なビュー pair は `toSelectValues` が `null`（＝当該軸オフ）に倒す（ビューで有効化するなら両値の指定が要る）。
 */
function resolveOneAxis(
  config: ConfigLike,
  trueKey: string,
  falseKey: string,
  settingsTrue: string,
  settingsFalse: string,
): SelectValues | null {
  const optionTrue = normalizeSelectValue(safeGetOption(config, trueKey));
  const optionFalse = normalizeSelectValue(safeGetOption(config, falseKey));
  // ビューがどちらか一方でも指定していれば、ビューの pair をアトミックに採用する（設定既定を混ぜない）。
  if (optionTrue !== null || optionFalse !== null) {
    return toSelectValues(optionTrue, optionFalse);
  }
  // ビューが両方未設定のときだけ設定既定の pair 全体へフォールバックする。
  return toSelectValues(normalizeSelectValue(settingsTrue), normalizeSelectValue(settingsFalse));
}

/**
 * 両軸の選択値を解決する。ビュー options を主とし、未設定・不正なら設定既定へフォールバックする。
 * 返り値の `null` は当該軸の選択軸オフ（読み取り側が文字列を配置せず v1＝未分類＋ロックを維持する）。
 */
export function resolveSelectValues(
  config: ConfigLike,
  settings: EisenhowerSettings,
): AxisSelectValues {
  return {
    urgent: resolveOneAxis(
      config,
      URGENT_SELECT_TRUE_OPTION_KEY,
      URGENT_SELECT_FALSE_OPTION_KEY,
      settings.defaultUrgencySelectTrueValue,
      settings.defaultUrgencySelectFalseValue,
    ),
    important: resolveOneAxis(
      config,
      IMPORTANT_SELECT_TRUE_OPTION_KEY,
      IMPORTANT_SELECT_FALSE_OPTION_KEY,
      settings.defaultImportanceSelectTrueValue,
      settings.defaultImportanceSelectFalseValue,
    ),
  };
}
