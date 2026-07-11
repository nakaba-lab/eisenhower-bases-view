/**
 * 滞留しきい値の解決（ビュー options 主 + グローバル既定＝ハイブリッド・#106）。
 *
 * 軸プロパティ（F4/#21）と同じハイブリッド: ビュー options（`config.get(KEY)`）を主とし、
 * 未設定・不正なら設定 `stagnationThresholdDays`（既定 14）にフォールバックする。Base ごとに
 * 性質が違う（例: Someday 用の Base はしきい値を長く）ため Base 単位で上書きできる。
 *
 * `config.get` は churn 対象の Bases API 接触点のため、`safeGetAsPropertyId`（`readAxis.ts`）と
 * 対称に try/catch で throw を境界退避し、ビュー全体の再描画を壊さず設定既定へ倒す。
 */
import type { EisenhowerSettings } from "../settings";

/**
 * Bases ビュー options のキー（滞留しきい値・日数）。本層は `config.get(key)` で `.base` の
 * view config が持つ値を読み、未設定なら設定タブのグローバル既定へフォールバックする（軸の
 * `getAsPropertyId` と対称の numeric 版）。
 *
 * ⚠️ v1 では Configure view の**専用 UI コントロール（数値/slider オプション）は未登録**
 *（`buildAxisViewOptions` は軸 property セレクタのみ宣言）。Base 単位の上書きは `.base` の view config に
 * 本キーを手で置いたときに効く。GUI コントロールの登録は Bases options round-trip の実機スパイク後に
 * 別途行う（CLAUDE.md「着手前スパイク必須」の Bases UI 方針。しきい値の主動線は設定タブのグローバル値）。
 */
export const STAGNATION_OPTION_KEY = "stagnationThresholdDays";

/** `config.get` だけを要求する最小形（テスト・呼び出し側が部分実装を渡せるように緩める）。 */
type ConfigLike = { get?(key: string): unknown } | null | undefined;

/**
 * options 由来の生値を「有限・0 以上の整数日」に正規化する（不正なら null＝フォールバック要求）。
 * `0` はオフの有効値。負・非数値・NaN は null（設定既定へ）。小数は `floor` して整数日にする。
 */
function toThresholdDays(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return null;
}

/** `config.get(key)` を **throw させない**境界防御でくるむ（`safeGetAsPropertyId` と対称・churn 耐性）。 */
function safeGetOption(config: ConfigLike, key: string): unknown {
  if (config == null || typeof config.get !== "function") return undefined;
  try {
    return config.get(key);
  } catch (error) {
    console.error("[Eisenhower Matrix] config.get failed; using default stagnation threshold", error);
    return undefined;
  }
}

/**
 * 滞留しきい値（日数）を解決する。ビュー options を主とし、未設定・不正なら設定既定にフォールバックする。
 * 返り値の `0` は機能オフ（`evaluateStagnation` が常に滞留しない）。
 */
export function resolveStagnationThresholdDays(
  config: ConfigLike,
  settings: EisenhowerSettings,
): number {
  const fromOption = toThresholdDays(safeGetOption(config, STAGNATION_OPTION_KEY));
  return fromOption ?? settings.stagnationThresholdDays;
}
