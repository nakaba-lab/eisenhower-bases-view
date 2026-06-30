import { BasesView, type QueryController } from "obsidian";
import { render, unmount } from "../ui/MatrixView";
import { emptyPlacements, toViewModel } from "./toViewModel";
import { VIEW_ID } from "./registerView";
import type { EisenhowerSettings } from "../settings";

/**
 * Bases カスタムビュー本体（`BasesView` サブクラス）。
 *
 * Bases の `onDataUpdated` で最新 entries を {@link toViewModel} で ViewModel 化し、
 * UI（{@link render}）へ橋渡しする（AC3）。#19（F2）で `this.config`（ビュー options）と
 * プラグイン設定（軸プロパティのデフォルト）を渡し、各 entry の軸値読み取り・象限配置を行う。
 * ビュー破棄時に Preact ルートを `unmount` してリークを防ぐ（AC4）。
 *
 * `extends BasesView` のため obsidian ランタイムが必要で、単体テストの対象外。
 * 登録・描画・解除の往復は手動/結合で担保する（DoD・スパイク #16 で実機確認済み）。
 */
export class EisenhowerBasesView extends BasesView {
  type = VIEW_ID;

  private readonly viewContainerEl: HTMLElement;
  /** 最新の設定を取得する（設定タブ変更後も陳腐化しないよう getter で受ける）。 */
  private readonly getSettings: () => EisenhowerSettings;

  constructor(
    controller: QueryController,
    containerEl: HTMLElement,
    getSettings: () => EisenhowerSettings,
  ) {
    super(controller);
    this.viewContainerEl = containerEl;
    this.getSettings = getSettings;
    // データ到着前は loading シェルを描画し、onDataUpdated で実データに差し替える。
    render(this.viewContainerEl, { state: "loading", entries: [], placements: emptyPlacements() });
  }

  onDataUpdated(): void {
    // this.data がまだ無い異常状態でも落とさず空シェルを描く（防御的アクセス）。
    render(
      this.viewContainerEl,
      toViewModel(this.data?.data, this.config, this.getSettings()),
    );
  }

  onunload(): void {
    unmount(this.viewContainerEl);
  }
}
