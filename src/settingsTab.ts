import { PluginSettingTab, Setting, type App } from "obsidian";
import type EisenhowerBasesViewPlugin from "./main";
import { QUADRANT_KEYS } from "./logic/quadrant";
import { messagesFor, resolveLanguage } from "./i18n";
import type { LanguageSetting } from "./settings";

/**
 * プラグイン設定タブ（#23 F6）。Obsidian 標準 `Setting` を使い `setHeading` で 4 区分
 *（軸／表示／象限ラベル・色／言語）に分ける（ワイヤーフレーム案 A・人間承認済み）。
 *
 * 各コントロールの `onChange` は `plugin.saveSettings()` を呼ぶ。`saveSettings` は `saveData` に
 * 加えて開いているビューを再描画するため、変更はマトリクスへ即時反映される（AC1/AC2）。
 * `extends PluginSettingTab` のため obsidian ランタイムが必要で単体テスト対象外（手動/結合で担保）。
 */

/** カラーピッカーが空（テーマ既定）のとき表示する中立的な既定色。 */
const PLACEHOLDER_ACCENT = "#8a8f98";

export class EisenhowerSettingTab extends PluginSettingTab {
  private readonly plugin: EisenhowerBasesViewPlugin;

  constructor(app: App, plugin: EisenhowerBasesViewPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;
    // 現在の解決言語で既定ラベル（placeholder）と軸ラベルを出す（Auto は Obsidian 言語に追従）。
    const messages = messagesFor(
      resolveLanguage(settings.language, this.plugin.getObsidianLanguage()),
    );

    // ▸ 軸（デフォルト）
    new Setting(containerEl).setName("軸（デフォルト）").setHeading();
    new Setting(containerEl)
      .setName("緊急度プロパティ")
      .setDesc("ビュー未設定時に使う緊急度軸の frontmatter プロパティ名。")
      .addText((text) =>
        text.setValue(settings.defaultUrgencyProperty).onChange(async (value) => {
          settings.defaultUrgencyProperty = value.trim();
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("重要度プロパティ")
      .setDesc("ビュー未設定時に使う重要度軸の frontmatter プロパティ名。")
      .addText((text) =>
        text
          .setValue(settings.defaultImportanceProperty)
          .onChange(async (value) => {
            settings.defaultImportanceProperty = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    // ▸ 表示
    new Setting(containerEl).setName("表示").setHeading();
    new Setting(containerEl)
      .setName("欠損ノートを未分類に表示")
      .setDesc("軸プロパティを持たないノートを未分類ゾーンに表示する。")
      .addToggle((toggle) =>
        toggle.setValue(settings.showUnclassified).onChange(async (value) => {
          settings.showUnclassified = value;
          await this.plugin.saveSettings();
        }),
      );

    // ▸ 象限ラベル・色
    new Setting(containerEl).setName("象限ラベル・色").setHeading();
    for (const key of QUADRANT_KEYS) {
      new Setting(containerEl)
        .setName(`${messages.quadrantLabels[key]}（${messages.axisLabels[key]}）`)
        .addText((text) =>
          text
            .setPlaceholder(messages.quadrantLabels[key])
            .setValue(settings.quadrantLabels[key])
            .onChange(async (value) => {
              settings.quadrantLabels[key] = value;
              await this.plugin.saveSettings();
            }),
        )
        .addColorPicker((picker) =>
          picker
            .setValue(settings.quadrantColors[key] || PLACEHOLDER_ACCENT)
            .onChange(async (value) => {
              settings.quadrantColors[key] = value;
              await this.plugin.saveSettings();
            }),
        )
        .addExtraButton((button) =>
          button
            .setIcon("rotate-ccw")
            .setTooltip("既定に戻す（ラベル・色）")
            .onClick(async () => {
              settings.quadrantLabels[key] = "";
              settings.quadrantColors[key] = "";
              await this.plugin.saveSettings();
              this.display(); // フィールド表示を既定へ戻すため再描画する。
            }),
        );
    }

    // ▸ 言語
    new Setting(containerEl).setName("言語").setHeading();
    new Setting(containerEl)
      .setName("表示言語")
      .setDesc("Auto は Obsidian の表示言語に追従します。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto")
          .addOption("en", "English")
          .addOption("ja", "日本語")
          .setValue(settings.language)
          .onChange(async (value) => {
            settings.language = value as LanguageSetting;
            await this.plugin.saveSettings();
            this.display(); // 既定ラベル placeholder を新言語で出し直すため再描画する。
          }),
      );
  }
}
