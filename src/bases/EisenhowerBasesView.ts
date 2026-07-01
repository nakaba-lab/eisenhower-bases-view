import { BasesView, Notice, TFile, type QueryController } from "obsidian";
import { render, unmount } from "../ui/MatrixView";
import { emptyPlacements, toViewModel } from "./toViewModel";
import { resolveWritableAxisKeys } from "./readAxis";
import { VIEW_ID } from "./registerView";
import type { AxisWriteValues, MatrixCallbacks } from "./types";
import type { EisenhowerSettings } from "../settings";

/**
 * Bases カスタムビュー本体（`BasesView` サブクラス）。
 *
 * Bases の `onDataUpdated` で最新 entries を {@link toViewModel} で ViewModel 化し、
 * UI（{@link render}）へ橋渡しする（AC3）。#19（F2）で `this.config`（ビュー options）と
 * プラグイン設定（軸プロパティのデフォルト）を渡し、各 entry の軸値読み取り・象限配置を行う。
 * #20（F3）でドラッグ書き戻し（`MatrixCallbacks.onMoveCard`）を実装し、`processFrontMatter` で
 * 両軸を明示書き込みする（読み取り `getValue` とは別系統）。
 * ビュー破棄時に Preact ルートを `unmount` してリークを防ぐ（AC4）。
 *
 * `extends BasesView` のため obsidian ランタイムが必要で、単体テストの対象外。
 * 登録・描画・書き戻しの往復は手動/結合で担保する（DoD・スパイク #16 で実機確認済み）。
 */
export class EisenhowerBasesView extends BasesView {
  type = VIEW_ID;

  private readonly viewContainerEl: HTMLElement;
  /** 最新の設定を取得する（設定タブ変更後も陳腐化しないよう getter で受ける）。 */
  private readonly getSettings: () => EisenhowerSettings;
  /** UI から委譲される操作（#20: ドラッグ書き戻し）。 */
  private readonly callbacks: MatrixCallbacks;

  constructor(
    controller: QueryController,
    containerEl: HTMLElement,
    getSettings: () => EisenhowerSettings,
  ) {
    super(controller);
    this.viewContainerEl = containerEl;
    this.getSettings = getSettings;
    this.callbacks = {
      onMoveCard: (entryId, axisValues) => this.writeBackAxes(entryId, axisValues),
      onOpenCard: (entryId, opts) => this.openNote(entryId, opts.newLeaf),
      onHoverCard: (entryId, targetEl, event) =>
        this.previewNote(entryId, targetEl, event),
    };
    // データ到着前は loading シェルを描画し、onDataUpdated で実データに差し替える。
    render(this.viewContainerEl, {
      state: "loading",
      entries: [],
      placements: emptyPlacements(),
    });
  }

  onDataUpdated(): void {
    // this.data がまだ無い異常状態でも落とさず空シェルを描く（防御的アクセス）。
    render(
      this.viewContainerEl,
      toViewModel(this.data?.data, this.config, this.getSettings()),
      this.callbacks,
    );
  }

  onunload(): void {
    unmount(this.viewContainerEl);
  }

  /**
   * `entryId`（=file.path）から操作対象の `TFile` を解決する（書き戻し #20／オープン #22 で共通）。
   * 見つからなければ `actionLabel` を差し込んだ `Notice` を出して `null` を返す
   *（呼び出し側は移動なら throw でロールバック、オープンなら return と制御を分ける）。
   */
  private resolveTargetFile(entryId: string, actionLabel: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(entryId);
    if (file instanceof TFile) return file;
    new Notice(`Eisenhower Matrix: 対象ファイルが見つからないため${actionLabel}。`);
    return null;
  }

  /**
   * ドラッグ書き戻し（#20 F3）: 両軸を明示 `true/false` で frontmatter へ書き込む（`delete` しない）。
   *
   * 軸 propertyId を解決し（ビュー options 主・設定デフォルト）、`note.<key>` のキーへ
   * `app.fileManager.processFrontMatter` で書く。`note.` 以外（formula/file）やファイル欠落・
   * 書き込み失敗は `Notice` を出して reject し、UI 側に楽観移動のロールバックを促す。
   */
  private async writeBackAxes(
    entryId: string,
    axisValues: AxisWriteValues,
  ): Promise<void> {
    // 書込可能な note.* 軸か（両軸）を frontmatter に触れる前に判定して弾く（AC3）。
    const keys = resolveWritableAxisKeys(this.config, this.getSettings());
    if (keys === null) {
      new Notice(
        "Eisenhower Matrix: 書き戻せない軸プロパティ（note. 以外）のため移動できません。",
      );
      throw new Error("axis property is not writable (formula/file)");
    }

    const file = this.resolveTargetFile(entryId, "移動できません");
    if (!file) {
      throw new Error(`target file not found: ${entryId}`);
    }

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[keys.urgent] = axisValues.urgent;
        frontmatter[keys.important] = axisValues.important;
      });
    } catch (error) {
      console.error("[Eisenhower Matrix] frontmatter 書き戻しに失敗しました", error);
      new Notice("Eisenhower Matrix: 書き戻しに失敗しました。元に戻します。");
      throw error;
    }
  }

  /**
   * カードのノートを開く（#22 F5・AC1/AC2/AC4）。
   *
   * `entryId`（=file.path）から `TFile` を解決し、`newLeaf`（Cmd/Ctrl+ で true）に応じて
   * 現在のリーフ（`false`）または新規タブ（`"tab"`）で開く。ファイル欠落時は `Notice`（読みと同系統の防御）。
   * UI は `obsidian` 型に触れず、`workspace` 操作はここ（アダプタ）に隔離する（AC5）。
   */
  private openNote(entryId: string, newLeaf: boolean): void {
    const file = this.resolveTargetFile(entryId, "開けません");
    if (!file) return;
    void this.app.workspace.getLeaf(newLeaf ? "tab" : false).openFile(file);
  }

  /**
   * カードのホバーでページプレビューを起動する（#22 F5・AC3）。
   *
   * Obsidian コアの page-preview へ `hover-link` イベントを発火するだけで、実際に表示するかは
   * ユーザーのコア「ページプレビュー」設定（例: Ctrl 必須）に委ねる（プラグインは preview を再実装しない）。
   * `linktext`/`sourcePath` は entryId（file.path）、`targetEl` はプレビュー位置決めのカード要素。
   */
  private previewNote(
    entryId: string,
    targetEl: HTMLElement,
    event: MouseEvent,
  ): void {
    this.app.workspace.trigger("hover-link", {
      event,
      source: VIEW_ID,
      hoverParent: this,
      targetEl,
      linktext: entryId,
      sourcePath: entryId,
    });
  }
}
