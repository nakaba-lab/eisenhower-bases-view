import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type EisenhowerSettings } from "./settings";
import { EisenhowerBasesView } from "./bases/EisenhowerBasesView";
import {
  VIEW_ICON,
  VIEW_ID,
  VIEW_NAME,
  safeRegisterBasesView,
} from "./bases/registerView";

/**
 * Eisenhower Matrix（Obsidian Bases カスタムビュー）プラグインのエントリポイント。
 *
 * `onload` で Bases カスタムビューを登録する。Bases が無効な Vault では
 * `registerBasesView` が `false` を返す（または API が無い）ため、`safeRegisterBasesView`
 * で graceful に握り、設定ロード等の他機能を壊さない（AC2）。
 * 登録ビューは Plugin ライフサイクルで解除される（各ビューの onunload で Preact を unmount）。
 */
export default class EisenhowerBasesViewPlugin extends Plugin {
  settings: EisenhowerSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    safeRegisterBasesView(
      () =>
        this.registerBasesView(VIEW_ID, {
          name: VIEW_NAME,
          icon: VIEW_ICON,
          factory: (controller, containerEl) =>
            new EisenhowerBasesView(controller, containerEl),
        }),
      () => {
        console.warn(
          "[Eisenhower Matrix] Bases が無効なためカスタムビューを登録できませんでした。",
        );
        new Notice(
          "Eisenhower Matrix: Bases が無効なためビューを登録できませんでした。",
        );
      },
    );
  }

  onunload(): void {
    // registerBasesView の登録は Plugin ライフサイクルで解除される。
    // 各 EisenhowerBasesView は onunload で Preact ルートを unmount し DOM リークを防ぐ。
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
