/**
 * プラグイン全体の設定（軸プロパティのデフォルト・象限ラベル/色・欠損表示・表示言語）。
 *
 * 軸プロパティ名の指定は「ハイブリッド」: Bases ビュー options を主とし、
 * ここの値は未設定時のデフォルトとして使う（docs/要件定義書.md「主要機能 F4」）。
 * #23（F6）で設定タブから編集する `language`／`quadrantLabels`／`quadrantColors` を追加した。
 */
import { mapQuadrantKeys, type QuadrantKey } from "./logic/quadrant";
import { toThresholdDays } from "./bases/stagnationThreshold";

/** 表示言語の設定値。`auto` は Obsidian のアプリ言語に追従する（解決は `src/i18n.ts`）。 */
export type LanguageSetting = "auto" | "en" | "ja";

export interface EisenhowerSettings {
  /** 緊急度軸に対応する frontmatter プロパティ名（未設定ビューのデフォルト）。 */
  defaultUrgencyProperty: string;
  /** 重要度軸に対応する frontmatter プロパティ名（未設定ビューのデフォルト）。 */
  defaultImportanceProperty: string;
  /** 軸プロパティが欠損したノートを未分類ゾーンに表示するか。 */
  showUnclassified: boolean;
  /** 表示言語（`auto`＝Obsidian 追従 / `en` / `ja`・#23 F6）。 */
  language: LanguageSetting;
  /** 象限ごとのカスタムラベル。空文字＝言語既定にフォールバック（#23 F6）。 */
  quadrantLabels: Record<QuadrantKey, string>;
  /** 象限ごとのカスタムアクセント色（hex）。空文字＝テーマ既定にフォールバック（#23 F6）。 */
  quadrantColors: Record<QuadrantKey, string>;
  /**
   * 滞留とみなす日数のグローバル既定（#106 F9）。最終更新から N 日を超えたカードに滞留マークを付ける。
   * ビュー options 未設定時のフォールバック（軸プロパティと同じハイブリッド）。`0` は機能オフ。
   */
  stagnationThresholdDays: number;
  /**
   * カードに表示する追加プロパティ（読み取り専用バッジ）の propertyId 既定（#104 F8）。
   * ビュー options 未設定時に使うデフォルト。既定 `[]`＝表示 0 個（カード密度は現状維持）。
   * 読み取り専用サーフェスのため `note.*` に限らず `formula.*`／`file.*` も指定できる。
   */
  cardBadgeProperties: string[];
  /** 期日らしい値（厳格 ISO・今日以前）をアクセント強調するか（#104 F8・既定オフ）。 */
  emphasizePastDates: boolean;
  /**
   * カード上の完了トグル（#105 F10）の完了プロパティ名（boolean の `note.*`）。
   * 既定は空文字＝**機能オフの opt-in**（例 `done`）。ビュー options 未設定時のデフォルト
   *（軸プロパティと同じハイブリッド）。空・非 boolean・軸と同一キーは実行時に無効化される。
   */
  completionProperty: string;
  /**
   * 完了ノートをカードで淡色表示するか（#105 F10・既定オフ）。Base に `done != true` フィルタを
   * 張らない利用者向けの表示のみのオプション（消す/残すの本体は Bases 委譲）。
   */
  dimCompleted: boolean;
}

/** 全象限を空文字で初期化した Record（ラベル/色の既定＝「未カスタム」を表す）。 */
function emptyQuadrantRecord(): Record<QuadrantKey, string> {
  return mapQuadrantKeys(() => "");
}

/** 滞留とみなす日数の既定（14 日）。#106。 */
export const DEFAULT_STAGNATION_THRESHOLD_DAYS = 14;

export const DEFAULT_SETTINGS: EisenhowerSettings = {
  defaultUrgencyProperty: "urgent",
  defaultImportanceProperty: "important",
  showUnclassified: true,
  language: "auto",
  quadrantLabels: emptyQuadrantRecord(),
  quadrantColors: emptyQuadrantRecord(),
  stagnationThresholdDays: DEFAULT_STAGNATION_THRESHOLD_DAYS,
  cardBadgeProperties: [],
  emphasizePastDates: false,
  completionProperty: "",
  dimCompleted: false,
};

/** `loadData()` 由来の値を文字列だけの配列に整える（非配列は空・非文字列要素は捨てる。手編集の防御）。 */
function mergeStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["auto", "en", "ja"];

function isLanguageSetting(value: unknown): value is LanguageSetting {
  return (
    typeof value === "string" &&
    (LANGUAGE_SETTINGS as readonly string[]).includes(value)
  );
}

/**
 * `loadData()` 由来の滞留しきい値日数を検証して整数へ正規化する（欠損・不正値は既定へ）。
 * 正規化規則は options 解決側と共有の {@link toThresholdDays}（有限・0 以上・小数は floor・`0` はオフ）。
 * 不正（負・非数値・NaN）は `null` が返るため手編集された `data.json` 等の不正値として既定（14）へ倒す。
 * `toThresholdDays(0)` は `0` を返し `0 ?? DEFAULT === 0`（`??` は `0` を保持）＝オフ設定は既定に潰れない。
 */
function mergeStagnationThresholdDays(raw: unknown): number {
  return toThresholdDays(raw) ?? DEFAULT_STAGNATION_THRESHOLD_DAYS;
}

/** `loadData()` 由来の Record<QuadrantKey,string> を既定（空文字）で補完する（欠損キー対策）。 */
function mergeQuadrantRecord(raw: unknown): Record<QuadrantKey, string> {
  const source = (raw ?? {}) as Partial<Record<QuadrantKey, unknown>>;
  return mapQuadrantKeys((key) => {
    const value = source[key];
    return typeof value === "string" ? value : "";
  });
}

/**
 * `loadData()` の生データを {@link DEFAULT_SETTINGS} へマージする（AC5 永続化の再読込）。
 *
 * `Object.assign` の浅いマージではネスト（`quadrantLabels`／`quadrantColors`）の欠損キーが
 * `undefined` のまま残り参照時に壊れる。本関数はフィールド単位で型検査しつつ既定補完し、
 * ネストの欠損キーも空文字で埋める。返り値は常に新規オブジェクト（`DEFAULT_SETTINGS` を破壊しない）。
 */
export function mergeSettings(loaded: unknown): EisenhowerSettings {
  const data = (loaded ?? {}) as Partial<Record<keyof EisenhowerSettings, unknown>>;
  return {
    defaultUrgencyProperty:
      typeof data.defaultUrgencyProperty === "string"
        ? data.defaultUrgencyProperty
        : DEFAULT_SETTINGS.defaultUrgencyProperty,
    defaultImportanceProperty:
      typeof data.defaultImportanceProperty === "string"
        ? data.defaultImportanceProperty
        : DEFAULT_SETTINGS.defaultImportanceProperty,
    showUnclassified:
      typeof data.showUnclassified === "boolean"
        ? data.showUnclassified
        : DEFAULT_SETTINGS.showUnclassified,
    language: isLanguageSetting(data.language)
      ? data.language
      : DEFAULT_SETTINGS.language,
    quadrantLabels: mergeQuadrantRecord(data.quadrantLabels),
    quadrantColors: mergeQuadrantRecord(data.quadrantColors),
    stagnationThresholdDays: mergeStagnationThresholdDays(data.stagnationThresholdDays),
    cardBadgeProperties: mergeStringArray(data.cardBadgeProperties),
    emphasizePastDates:
      typeof data.emphasizePastDates === "boolean"
        ? data.emphasizePastDates
        : DEFAULT_SETTINGS.emphasizePastDates,
    completionProperty:
      typeof data.completionProperty === "string"
        ? data.completionProperty
        : DEFAULT_SETTINGS.completionProperty,
    dimCompleted:
      typeof data.dimCompleted === "boolean"
        ? data.dimCompleted
        : DEFAULT_SETTINGS.dimCompleted,
  };
}
