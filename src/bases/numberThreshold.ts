/**
 * 数値しきい値軸（#121 v0.3-1a）の per-axis しきい値解決（ビュー options 主 + 設定既定＝ハイブリッド）。
 *
 * 軸プロパティ（F4/#21）・滞留しきい値（#106）と同じハイブリッド: ビュー options（`config.get(KEY)`）を
 * 主とし、未設定・不正なら設定既定（`defaultUrgencyThreshold`／`defaultImportanceThreshold`）へ
 * フォールバックする。Base ごとに数値規約が違う（例: 期日までの日数 / 優先度スコア）ため per-axis で持つ。
 *
 * 滞留しきい値（非負整数・`0`＝オフ）と違い、数値軸しきい値は**負値・小数も有効で `0` も有効値**のため、
 * 「未設定（オフ）」を `null`（＝設定タブ空文字＋ビュー options 未設定）で表す（別 sentinel）。`null` の軸では
 * 数値も配置せず v1（未分類＋ロック）を維持し、v0.3 アップグレード時に既存の数値 `note.*` が不意に象限へ
 * 現れる驚きを防ぐ。GUI コントロールは 1a では未登録（滞留しきい値 v1 と同型＝`.base` の view config に手で
 * 置けば効く。数値オプション UI の実機スパイク後に別途）。設計は `docs/design/bases.md`「数値しきい値軸アダプタ配線」。
 *
 * `config.get` は churn 対象の Bases API 接触点のため、`stagnationThreshold.safeGetOption` と対称に
 * try/catch で throw を境界退避し、ビュー全体の再描画を壊さず設定既定へ倒す。
 */
import type { EisenhowerSettings } from "../settings";
import { logChurnFailureOnce } from "./readAxis";

/**
 * Bases ビュー options のキー（数値しきい値・緊急度／重要度）。本層は `config.get(key)` で `.base` の
 * view config が持つ値を読み、未設定なら設定タブのグローバル既定へフォールバックする（軸の
 * `getAsPropertyId`・滞留の numeric 版と対称）。
 */
export const URGENT_NUMBER_THRESHOLD_OPTION_KEY = "urgentNumberThreshold";
export const IMPORTANT_NUMBER_THRESHOLD_OPTION_KEY = "importantNumberThreshold";

/** 解決済みの per-axis しきい値。`null` は当該軸の数値軸オフ（未設定）。 */
export interface NumberThresholds {
  urgent: number | null;
  important: number | null;
}

/** `config.get` だけを要求する最小形（テスト・呼び出し側が部分実装を渡せるように緩める）。 */
type ConfigLike = { get?(key: string): unknown } | null | undefined;

/**
 * 生値（options 由来・設定文字列）を数値しきい値へ正規化する（不正・未設定は `null`）。
 * 有限数（負・小数も有効・`0` も有効値）はそのまま、数値文字列は `Number()` で数値化する。空文字・空白のみ・
 * 非数値・`NaN`・非有限（`±Inf`）・null/undefined は `null`（呼び出し側が「数値軸オフ」に倒す）。
 * 設定読込側（`settings.mergeThresholdString`）は string 化のみを担い、**数値解釈はここに一本化**する。
 */
export function toNumberThreshold(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 既にログ済みの失敗 option キー（`logChurnFailureOnce` が再描画毎の多重ログを間引く）。 */
const loggedGetOptionFailures = new Set<string>();

/** `config.get(key)` を **throw させない**境界防御でくるむ（滞留 `safeGetOption` と対称・churn 耐性）。 */
function safeGetOption(config: ConfigLike, key: string): unknown {
  if (config == null || typeof config.get !== "function") return undefined;
  try {
    return config.get(key);
  } catch (error) {
    logChurnFailureOnce(
      loggedGetOptionFailures,
      key,
      "config.get failed; using default number threshold",
      error,
    );
    return undefined;
  }
}

/**
 * 両軸の数値しきい値を解決する。ビュー options を主とし、未設定・不正なら設定既定へフォールバックする。
 * 返り値の `null` は当該軸の数値軸オフ（読み取り側が数値を配置せず v1＝未分類＋ロックを維持する）。
 */
export function resolveNumberThresholds(
  config: ConfigLike,
  settings: EisenhowerSettings,
): NumberThresholds {
  return {
    urgent:
      toNumberThreshold(safeGetOption(config, URGENT_NUMBER_THRESHOLD_OPTION_KEY)) ??
      toNumberThreshold(settings.defaultUrgencyThreshold),
    important:
      toNumberThreshold(safeGetOption(config, IMPORTANT_NUMBER_THRESHOLD_OPTION_KEY)) ??
      toNumberThreshold(settings.defaultImportanceThreshold),
  };
}
