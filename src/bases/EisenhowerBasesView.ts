import { BasesView, type QueryController } from "obsidian";
import { render, unmount } from "../ui/MatrixView";
import { toViewModel } from "./toViewModel";
import { VIEW_ID } from "./registerView";

/**
 * Bases カスタムビュー本体（`BasesView` サブクラス）。
 *
 * Bases の `onDataUpdated` で最新 entries を {@link toViewModel} で ViewModel 化し、
 * UI（{@link render}）へ橋渡しする（AC3）。ビュー破棄時に Preact ルートを
 * `unmount` してリークを防ぐ（AC4）。
 *
 * `extends BasesView` のため obsidian ランタイムが必要で、単体テストの対象外。
 * 登録・描画・解除の往復は手動/結合で担保する（DoD・スパイク #16 で実機確認済み）。
 */
export class EisenhowerBasesView extends BasesView {
  type = VIEW_ID;

  private readonly viewContainerEl: HTMLElement;

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller);
    this.viewContainerEl = containerEl;
    // データ到着前は loading シェルを描画し、onDataUpdated で実データに差し替える。
    render(this.viewContainerEl, { state: "loading", entries: [] });
  }

  onDataUpdated(): void {
    render(this.viewContainerEl, toViewModel(this.data.data));
  }

  onunload(): void {
    unmount(this.viewContainerEl);
  }
}
