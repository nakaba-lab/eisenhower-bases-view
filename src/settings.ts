/**
 * プラグイン全体の設定（軸プロパティのデフォルト等）。
 *
 * 軸プロパティ名の指定は「ハイブリッド」: Bases ビュー options を主とし、
 * ここの値は未設定時のデフォルトとして使う（docs/要件定義書.md「主要機能 F4」）。
 */
export interface EisenhowerSettings {
  /** 緊急度軸に対応する frontmatter プロパティ名（未設定ビューのデフォルト）。 */
  defaultUrgencyProperty: string;
  /** 重要度軸に対応する frontmatter プロパティ名（未設定ビューのデフォルト）。 */
  defaultImportanceProperty: string;
  /** 軸プロパティが欠損したノートを未分類ゾーンに表示するか。 */
  showUnclassified: boolean;
}

export const DEFAULT_SETTINGS: EisenhowerSettings = {
  defaultUrgencyProperty: "urgent",
  defaultImportanceProperty: "important",
  showUnclassified: true,
};
