/**
 * プラグイン全体の設定（軸プロパティのデフォルト・象限ラベル/色・欠損表示・表示言語）。
 *
 * 軸プロパティ名の指定は「ハイブリッド」: Bases ビュー options を主とし、
 * ここの値は未設定時のデフォルトとして使う（docs/要件定義書.md「主要機能 F4」）。
 * #23（F6）で設定タブから編集する `language`／`quadrantLabels`／`quadrantColors` を追加した。
 */
import { mapQuadrantKeys, type QuadrantKey } from "./logic/quadrant";

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
}

/** 全象限を空文字で初期化した Record（ラベル/色の既定＝「未カスタム」を表す）。 */
function emptyQuadrantRecord(): Record<QuadrantKey, string> {
  return mapQuadrantKeys(() => "");
}

export const DEFAULT_SETTINGS: EisenhowerSettings = {
  defaultUrgencyProperty: "urgent",
  defaultImportanceProperty: "important",
  showUnclassified: true,
  language: "auto",
  quadrantLabels: emptyQuadrantRecord(),
  quadrantColors: emptyQuadrantRecord(),
};

const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["auto", "en", "ja"];

function isLanguageSetting(value: unknown): value is LanguageSetting {
  return (
    typeof value === "string" &&
    (LANGUAGE_SETTINGS as readonly string[]).includes(value)
  );
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
  };
}
