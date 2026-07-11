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
import { logChurnFailureOnce } from "./readAxis";

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
 * 生値（options 由来・`loadData()` 由来）を「有限・0 以上の整数日」に正規化する（不正なら null）。
 * `0` はオフの有効値。負・非数値・NaN は null（呼び出し側が既定へ倒す）。小数は `floor` して整数日にする。
 * 設定読込側（`settings.mergeStagnationThresholdDays`）と options 解決側の**単一の正規化規則**
 *（同じ unknown を同じ規則で正規化する二重管理を避ける・レビュー指摘）。
 */
export function toThresholdDays(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return null;
}

/**
 * 設定タブのテキスト入力（文字列）を滞留しきい値へ解釈する（#106 F9・レビュー指摘）。
 * **`null` は「保存しない＝現在値を保持」**を表す（空欄＝入力途中・非数値・負値）。有効値のみ number を返す。
 * 空欄化を「無効化(0)」でも「既定復帰(14)」でもなく現在値保持にすることで、カスタム値を黙って
 * 上書きしない（無効化は `0` を明示入力する）。`extends PluginSettingTab` の設定タブから切り出して単体固定する。
 */
export function parseThresholdInput(raw: string): number | null {
  // 日本語 IME の全角数字（"３０"）を半角へ正規化してから判定する（一次利用者が全角で入力した有効値を
  // silent-drop しない・レビュー指摘）。U+FF10..FF19 → U+0030..0039。
  const trimmed = raw
    .trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  // 厳密な非負整数（10 進数字のみ）だけ受理する。`Number.parseInt` はプレフィックス受理のため
  // "14x"→14・"1e3"→1・"0x10"→0 を黙って通してしまう（文書化した「非数値は現在値保持」に反する・レビュー指摘）。
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

/** 既にログ済みの失敗 option キー（`logChurnFailureOnce` が再描画毎の多重ログを間引く）。 */
const loggedGetOptionFailures = new Set<string>();

/** `config.get(key)` を **throw させない**境界防御でくるむ（`safeGetAsPropertyId` と対称・churn 耐性）。 */
function safeGetOption(config: ConfigLike, key: string): unknown {
  if (config == null || typeof config.get !== "function") return undefined;
  try {
    return config.get(key);
  } catch (error) {
    // ログ方針は `readAxis.logChurnFailureOnce` に集約（兄弟ガードと一斉に変えられる・レビュー指摘）。
    logChurnFailureOnce(
      loggedGetOptionFailures,
      key,
      "config.get failed; using default stagnation threshold",
      error,
    );
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
