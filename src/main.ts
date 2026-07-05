import { Notice, Plugin, TAbstractFile } from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type EisenhowerSettings } from "./settings";
import { EisenhowerBasesView } from "./bases/EisenhowerBasesView";
import {
  VIEW_ICON,
  VIEW_ID,
  VIEW_NAME,
  safeRegisterBasesView,
} from "./bases/registerView";
import { buildAxisViewOptions } from "./bases/viewOptions";
import { runUndo } from "./bases/undoWriteBack";
import { EisenhowerSettingTab } from "./settingsTab";
import { UndoManager } from "./logic/undo";
import { messagesFor, resolveLanguage, type Messages } from "./i18n";

/**
 * Eisenhower Matrix（Obsidian Bases カスタムビュー）プラグインのエントリポイント。
 *
 * `onload` で設定タブ（#23 F6）を登録し、続けて Bases カスタムビューを登録する。Bases が無効な
 * Vault では `registerBasesView` が `false` を返す（または API が無い）ため、`safeRegisterBasesView`
 * で graceful に握り、設定ロード等の他機能を壊さない（AC2）。
 * 登録ビューは Plugin ライフサイクルで解除される（各ビューの onunload で Preact を unmount）。
 * 生存中ビューは登録簿（{@link liveViews}）で保持し、設定変更時に再描画して即時反映する（F6・AC1/AC2）。
 */
export default class EisenhowerBasesViewPlugin extends Plugin {
  settings: EisenhowerSettings = DEFAULT_SETTINGS;
  /** 生存中の Eisenhower ビュー（設定変更時に再描画する登録簿・#23 F6）。 */
  private readonly liveViews = new Set<EisenhowerBasesView>();
  /** 「直前 1 手」の undo 記録（全ビュー＋コマンドで共有・undo 最小実装）。 */
  private readonly undoManager = new UndoManager();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new EisenhowerSettingTab(this.app, this));

    // 直前の移動を元に戻すコマンド（ホットキーはユーザーが割当・Ctrl+Z 非統合）。
    // 名称は登録時点の解決言語で確定する（Obsidian はコマンド名を設定変更で再ローカライズしない）。
    this.addCommand({
      id: "undo-last-move",
      name: this.resolveMessages().undoCommandName,
      callback: () => {
        void runUndo(this.app, this.undoManager, this.resolveMessages());
      },
    });

    // 記録した path のファイルが削除/リネームされたら undo 記録を破棄する（パス再利用への誤 undo 防止）。
    // undo は path でノートを再解決するため、記録を残すと再利用された別ノートを上書き/delete しうる
    // （値照合 isUndoApplicable では同一象限の別ノートを区別できない＝レビュー指摘）。path 無効化の時点で断つ。
    // registerEvent で Plugin ライフサイクルに紐づけ、onunload で自動解除する。
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        this.undoManager.clearIfEntry(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (_file: TAbstractFile, oldPath: string) => {
        this.undoManager.clearIfEntry(oldPath);
      }),
    );

    safeRegisterBasesView(
      () =>
        this.registerBasesView(VIEW_ID, {
          name: VIEW_NAME,
          icon: VIEW_ICON,
          factory: (controller, containerEl) =>
            new EisenhowerBasesView(
              controller,
              containerEl,
              () => this.settings,
              () => this.resolveMessages(),
              this.liveViews,
              this.undoManager,
            ),
          // 軸プロパティ選択 UI（#21 F4）: note.* のみ選択可の property セレクタを
          // Configure view へ宣言する（filter は書き戻し可能な note.* 判定・AC1）。
          // displayName は評価時点の解決言語に追従する（#23 F6 の i18n・AC4）。
          options: () => buildAxisViewOptions(this.resolveMessages()),
        }),
      () => {
        console.warn(
          "[Eisenhower Matrix] Bases is disabled; could not register the custom view.",
        );
        // 登録失敗時の唯一のユーザー向けフィードバックのため、他 Notice と同じく言語追従させる
        // （Bases ビューなのでこの状態では他に何も表示されない・#i18n レビュー指摘）。
        new Notice(`Eisenhower Matrix: ${this.resolveMessages().basesUnavailable}`);
      },
    );
  }

  onunload(): void {
    // registerBasesView の登録は Plugin ライフサイクルで解除される。
    // 各 EisenhowerBasesView は onunload で Preact ルートを unmount し登録簿から抜ける。
    this.liveViews.clear();
  }

  /** 設定の言語（Auto は Obsidian 追従）を解決した言語メッセージ束を返す（#23 F6・AC4）。 */
  resolveMessages(): Messages {
    return messagesFor(
      resolveLanguage(this.settings.language, this.getObsidianLanguage()),
    );
  }

  /** Obsidian のアプリ表示言語（`localStorage['language']`。未設定は null＝既定 en）。 */
  getObsidianLanguage(): string | null {
    try {
      return window.localStorage.getItem("language");
    } catch {
      return null;
    }
  }

  /** 設定変更を開いている全ビューへ即時反映する（#23 F6・AC1/AC2）。 */
  private refreshViews(): void {
    for (const view of this.liveViews) view.refresh();
  }

  async loadSettings(): Promise<void> {
    // 浅い Object.assign ではネスト（象限ラベル/色）の欠損キーが埋まらないため mergeSettings を使う。
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.refreshViews();
  }
}
