import { PluginSettingTab, Setting, type App } from "obsidian";
import type EisenhowerBasesViewPlugin from "./main";
import { QUADRANT_KEYS } from "./logic/quadrant";
import { messagesFor, resolveLanguage } from "./i18n";
import { DEFAULT_STAGNATION_THRESHOLD_DAYS, type LanguageSetting } from "./settings";

/**
 * プラグイン設定タブ（#23 F6）。Obsidian 標準 `Setting` を使い `setHeading` で 4 区分
 *（軸／表示／象限ラベル・色／言語）に分ける（ワイヤーフレーム案 A・人間承認済み）。
 *
 * 各コントロールの `onChange` は `plugin.saveSettings()` を呼ぶ。`saveSettings` は `saveData` に
 * 加えて開いているビューを再描画するため、変更はマトリクスへ即時反映される（AC1/AC2）。
 * `extends PluginSettingTab` のため obsidian ランタイムが必要で単体テスト対象外（手動/結合で担保）。
 */

/** カラーピッカーが空（テーマ既定）のときの最終フォールバック色（テーマ変数が読めない場合）。 */
const PLACEHOLDER_ACCENT = "#8a8f98";

/** 6 桁 hex（`#rrggbb`）判定。`ColorComponent` は hex を受けるためテーマ値をこの形に限定する。 */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export class EisenhowerSettingTab extends PluginSettingTab {
  private readonly plugin: EisenhowerBasesViewPlugin;

  constructor(app: App, plugin: EisenhowerBasesViewPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // Obsidian が設定タブを開く際に呼ぶ。実描画は render() に委譲する（minAppVersion 1.12.0 では
  // display() が正規のフォールバック API。1.13.0 の getSettingDefinitions は使わない）。
  display(): void {
    this.render();
  }

  // 設定タブの実描画。リセット・言語変更後の再描画にも使う（this.display() を直接呼ばない）。
  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.plugin.settings;
    // 現在の解決言語で既定ラベル（placeholder）と軸ラベルを出す（Auto は Obsidian 言語に追従）。
    const messages = messagesFor(
      resolveLanguage(settings.language, this.plugin.getObsidianLanguage()),
    );
    // 色未設定の象限はマトリクスでテーマのアクセント色（--interactive-accent）で描画されるため、
    // カラーピッカーのスウォッチも同色を初期表示して設定画面と実描画の食い違いを防ぐ
    //（frontend-reviewer 指摘）。テーマ値が hex でなければ中立の既定色にフォールバックする。
    const themeAccent = getComputedStyle(containerEl)
      .getPropertyValue("--interactive-accent")
      .trim();
    const accentPlaceholder = HEX6.test(themeAccent) ? themeAccent : PLACEHOLDER_ACCENT;

    // ▸ 軸（デフォルト）
    new Setting(containerEl).setName(messages.settings.axisHeading).setHeading();
    new Setting(containerEl)
      .setName(messages.settings.urgencyName)
      .setDesc(messages.settings.urgencyDesc)
      .addText((text) =>
        text.setValue(settings.defaultUrgencyProperty).onChange(async (value) => {
          settings.defaultUrgencyProperty = value.trim();
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName(messages.settings.importanceName)
      .setDesc(messages.settings.importanceDesc)
      .addText((text) =>
        text
          .setValue(settings.defaultImportanceProperty)
          .onChange(async (value) => {
            settings.defaultImportanceProperty = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    // ▸ 表示
    new Setting(containerEl).setName(messages.settings.displayHeading).setHeading();
    new Setting(containerEl)
      .setName(messages.settings.showUnclassifiedName)
      .setDesc(messages.settings.showUnclassifiedDesc)
      .addToggle((toggle) =>
        toggle.setValue(settings.showUnclassified).onChange(async (value) => {
          settings.showUnclassified = value;
          await this.plugin.saveSettings();
        }),
      );
    // 滞留とみなす日数（0=オフ・#106）。ビュー options 未設定時のグローバル既定。
    // 非負整数のみ受け付け、不正入力は既定へフォールバックする（mergeSettings の読込側ガードと対称）。
    new Setting(containerEl)
      .setName(messages.settings.stagnationName)
      .setDesc(messages.settings.stagnationDesc)
      .addText((text) =>
        text
          .setValue(String(settings.stagnationThresholdDays))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value.trim(), 10);
            settings.stagnationThresholdDays =
              Number.isFinite(parsed) && parsed >= 0
                ? parsed
                : DEFAULT_STAGNATION_THRESHOLD_DAYS;
            await this.plugin.saveSettings();
          }),
      );

    // ▸ 象限ラベル・色
    new Setting(containerEl).setName(messages.settings.quadrantHeading).setHeading();
    for (const key of QUADRANT_KEYS) {
      new Setting(containerEl)
        .setName(messages.labelWithAxis(messages.quadrantLabels[key], messages.axisLabels[key]))
        .setDesc(messages.settings.quadrantRowDesc)
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
            .setValue(settings.quadrantColors[key] || accentPlaceholder)
            .onChange(async (value) => {
              settings.quadrantColors[key] = value;
              await this.plugin.saveSettings();
            }),
        )
        .addExtraButton((button) =>
          button
            .setIcon("rotate-ccw")
            .setTooltip(messages.settings.resetTooltip)
            .onClick(async () => {
              settings.quadrantLabels[key] = "";
              settings.quadrantColors[key] = "";
              await this.plugin.saveSettings();
              this.render(); // フィールド表示を既定へ戻すため再描画する。
            }),
        );
    }

    // ▸ 言語
    new Setting(containerEl).setName(messages.settings.languageHeading).setHeading();
    new Setting(containerEl)
      .setName(messages.settings.languageName)
      .setDesc(messages.settings.languageDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", messages.settings.languageAuto)
          .addOption("en", "English")
          .addOption("ja", "日本語")
          .setValue(settings.language)
          .onChange(async (value) => {
            settings.language = value as LanguageSetting;
            await this.plugin.saveSettings();
            this.render(); // 既定ラベル placeholder を新言語で出し直すため再描画する。
          }),
      );
  }
}
