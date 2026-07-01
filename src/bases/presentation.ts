/**
 * presentation — 設定（カスタムラベル/色）と言語メッセージ（既定ラベル/色フォールバック）を
 * 合成して UI へ渡す表示情報を組む純関数（#23 F6・AC2）。
 *
 * ラベル: カスタム空＝言語既定にフォールバック、非空＝カスタム上書き（AC2 とラベル×言語の相互作用）。
 * 色: カスタム空＝空文字（UI 側でテーマ既定 `--interactive-accent` にフォールバック）、非空＝その hex。
 * Obsidian・Bases 非依存の純ロジックのため単体テストで固定する。
 */
import { mapQuadrantKeys, type QuadrantKey } from "../logic/quadrant";
import type { EisenhowerSettings } from "../settings";
import type { Messages } from "../i18n";
import type { MatrixPresentation } from "./types";

/** 象限ラベルを解決する（カスタム非空＝上書き・空＝言語既定）。 */
export function resolveQuadrantLabels(
  settings: EisenhowerSettings,
  messages: Messages,
): Record<QuadrantKey, string> {
  return mapQuadrantKeys((key) => {
    const custom = settings.quadrantLabels[key] ?? "";
    // 空白のみ（trim して空）は「未カスタム」とみなし言語既定へフォールバックする
    // （空白ラベルで見出しが不可視になるのを防ぐ・frontend-reviewer 指摘）。
    return custom.trim().length > 0 ? custom : messages.quadrantLabels[key];
  });
}

/** 象限色を解決する（カスタム非空＝その hex・空＝空文字でテーマ既定にフォールバック）。 */
export function resolveQuadrantColors(
  settings: EisenhowerSettings,
): Record<QuadrantKey, string> {
  return mapQuadrantKeys((key) => settings.quadrantColors[key] ?? "");
}

/** ラベル・色・言語メッセージを束ねた {@link MatrixPresentation} を組む。 */
export function resolvePresentation(
  settings: EisenhowerSettings,
  messages: Messages,
): MatrixPresentation {
  return {
    messages,
    quadrantLabels: resolveQuadrantLabels(settings, messages),
    quadrantColors: resolveQuadrantColors(settings),
  };
}
