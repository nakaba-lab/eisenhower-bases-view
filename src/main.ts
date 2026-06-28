import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type EisenhowerSettings } from "./settings";

/**
 * Eisenhower Matrix（Obsidian Bases カスタムビュー）プラグインのエントリポイント。
 *
 * 注意: 中核の `registerBasesView` によるカスタムビュー登録は、要件定義書で合意した
 * 「着手前スパイク」（登録→getValue 読み取り→processFrontMatter 書き戻し→onDataUpdated 再描画
 * の往復ループの実機確認）で API シグネチャ・再描画挙動を確証してから配線する。
 * 本ファイルは雛形段階のため最小の onload/onunload・設定ロードのみを持つ。
 */
export default class EisenhowerBasesViewPlugin extends Plugin {
  settings: EisenhowerSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    // TODO(spike): this.registerBasesView(...) でカスタムビューを登録する。
    // Bases が無効な Vault では registerBasesView が false を返すため graceful に扱う。
    console.log("Eisenhower Matrix (Bases view) plugin loaded");
  }

  onunload(): void {
    // TODO: 登録したビューの detach・リソース解放。
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
