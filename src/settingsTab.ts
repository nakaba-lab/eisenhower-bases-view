import { PluginSettingTab, Setting, type App } from "obsidian";
import type EisenhowerBasesViewPlugin from "./main";
import { QUADRANT_KEYS } from "./logic/quadrant";
import { messagesFor, resolveLanguage } from "./i18n";
import { MAX_BADGE_PROPERTIES } from "./bases/readBadges";
import { parseThresholdInput } from "./bases/stagnationThreshold";
import { type LanguageSetting } from "./settings";

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
    // 滞留とみなす日数（0=オフ・#106 F9）。ビュー options 未設定時のグローバル既定。
    // 空欄は「入力途中」であって無効化（0）でも既定復帰でもないため、空・非数値・負値は現在値を保持し、
    // カスタム値を黙って既定（14）へ上書きしない（無効化は 0 を明示入力する・レビュー指摘）。
    new Setting(containerEl)
      .setName(messages.settings.stagnationName)
      .setDesc(messages.settings.stagnationDesc)
      .addText((text) =>
        text
          .setValue(String(settings.stagnationThresholdDays))
          .onChange(async (value) => {
            // 空欄・非数値・負値（null）は現在値を保持する（無効化は 0 を明示入力・純関数で単体固定）。
            const days = parseThresholdInput(value);
            if (days === null) return;
            settings.stagnationThresholdDays = days;
            await this.plugin.saveSettings();
          }),
      );
    // カード追加プロパティ表示（#104 F8）: 表示する propertyId をカンマ区切りで既定指定する
    //（ビュー options が主・ここは未設定ビューのデフォルト）。読み取り専用のため formula.*/file.* も可。
    new Setting(containerEl)
      .setName(messages.settings.cardBadgePropertiesName)
      .setDesc(messages.settings.cardBadgePropertiesDesc)
      .addText((text) =>
        text
          .setPlaceholder("note.due, note.tags")
          .setValue(settings.cardBadgeProperties.join(", "))
          .onChange(async (value) => {
            // カンマ区切り→トリム→空除去→**重複除去→**最大数で丸める（入口で正規化する。永続層の
            // mergeStringArray は型フィルタのみのため、trim/空除去/dedup/丸めはここで行う）。
            // dedup を slice の前に置く（`resolveBadgePropertyIds` と同順）＝重複が 1 枠を消費して
            // 3 枠に収まる別プロパティが黙って押し出されるのを防ぐ（レビュー指摘）。
            const parsed = value
              .split(",")
              .map((item) => item.trim())
              .filter((item) => item.length > 0);
            settings.cardBadgeProperties = [...new Set(parsed)].slice(0, MAX_BADGE_PROPERTIES);
            await this.plugin.saveSettings();
          }),
      );
    // 期日強調トグル（#104 F8・AC4）: 厳格 ISO 日付が今日以前のバッジをアクセント強調する（既定オフ）。
    new Setting(containerEl)
      .setName(messages.settings.emphasizePastDatesName)
      .setDesc(messages.settings.emphasizePastDatesDesc)
      .addToggle((toggle) =>
        toggle.setValue(settings.emphasizePastDates).onChange(async (value) => {
          settings.emphasizePastDates = value;
          await this.plugin.saveSettings();
        }),
      );
    // カード上の完了トグル（#105 F10）: 完了プロパティ名（boolean note.*・空で無効＝opt-in）。
    // 完了ノートの表示/非表示は Base の done!=true フィルタに委譲する（README 参照）。ビュー options が主。
    new Setting(containerEl)
      .setName(messages.settings.completionName)
      .setDesc(messages.settings.completionDesc)
      .addText((text) =>
        text
          .setValue(settings.completionProperty)
          .onChange(async (value) => {
            settings.completionProperty = value.trim();
            await this.plugin.saveSettings();
          }),
      );
    // 完了ノート淡色表示トグル（#105 F10・既定オフ）: done!=true フィルタを張らない利用者向けの目印。
    new Setting(containerEl)
      .setName(messages.settings.dimCompletedName)
      .setDesc(messages.settings.dimCompletedDesc)
      .addToggle((toggle) =>
        toggle.setValue(settings.dimCompleted).onChange(async (value) => {
          settings.dimCompleted = value;
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
