import {
  BasesView,
  Notice,
  TFile,
  type HoverParent,
  type HoverPopover,
  type QueryController,
} from "obsidian";
import { render, unmount } from "../ui/MatrixView";
import { emptyPlacements, toViewModel } from "./toViewModel";
import { resolvePresentation } from "./presentation";
import { resolveWritableAxisKeys } from "./readAxis";
import { runUndo } from "./undoWriteBack";
import { VIEW_ID } from "./registerView";
import {
  capturePreviousAxes,
  type FrontmatterLike,
  type UndoManager,
  type UndoRecord,
} from "../logic/undo";
import type { AxisWriteValues, MatrixCallbacks } from "./types";
import type { EisenhowerSettings } from "../settings";
import type { Messages } from "../i18n";

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

/**
 * 今日の**ローカル日付**を ISO `YYYY-MM-DD` で返す（#104 F8 バッジの日付強調 AC4 用）。
 * 期日は利用者のローカル日付で「今日以前」を判定するため UTC ではなくローカル日付成分を使う。
 * `new Date()` に触れる不純関数のためアダプタ層に隔離し、純ロジック（`isEmphasizedDate`）へは
 * 解決済み文字列を注入する（`toViewModel` 経由）。
 */
function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class EisenhowerBasesView extends BasesView implements HoverParent {
  type = VIEW_ID;

  /**
   * core page-preview が読み書きするホバーポップオーバー slot（`HoverParent` 契約・#22 F5）。
   * `workspace.trigger("hover-link", { hoverParent: this, … })` の相手として、
   * コアがプレビューの生成・重複排除・破棄をここに紐付ける（未実装だと lifecycle が壊れる）。
   */
  hoverPopover: HoverPopover | null = null;

  private readonly viewContainerEl: HTMLElement;
  /** 最新の設定を取得する（設定タブ変更後も陳腐化しないよう getter で受ける）。 */
  private readonly getSettings: () => EisenhowerSettings;
  /** 最新の解決済み言語メッセージを取得する（設定の言語変更後も陳腐化しない・#23 F6）。 */
  private readonly getMessages: () => Messages;
  /** 生存中ビューの登録簿（設定変更時の再描画対象）。プラグインが所有し onunload で解除する。 */
  private readonly registry: Set<EisenhowerBasesView> | null;
  /** 「直前 1 手」の undo 記録（プラグインが所有・コマンドと共有）。 */
  private readonly undoManager: UndoManager | null;
  /** UI から委譲される操作（#20: ドラッグ書き戻し）。 */
  private readonly callbacks: MatrixCallbacks;
  /**
   * UI（MatrixView）が登録した「楽観オーバーレイを entryId 単位で落とす」関数（#6）。
   * コマンド経由 undo はコンポーネントを経由しないため、これを通してビュー内 pending を落とす。
   * UI のマウントで設定・アンマウントで null に戻る。
   */
  private pendingDropper: ((entryId: string) => void) | null = null;

  constructor(
    controller: QueryController,
    containerEl: HTMLElement,
    getSettings: () => EisenhowerSettings,
    getMessages: () => Messages,
    registry?: Set<EisenhowerBasesView>,
    undoManager?: UndoManager,
  ) {
    super(controller);
    this.viewContainerEl = containerEl;
    this.getSettings = getSettings;
    this.getMessages = getMessages;
    this.registry = registry ?? null;
    this.undoManager = undoManager ?? null;
    // 設定変更時の再描画対象として自身を登録する（#23 F6・AC1/AC2）。
    this.registry?.add(this);
    this.callbacks = {
      onMoveCard: (entryId, axisValues) => this.writeBackAxes(entryId, axisValues),
      onOpenCard: (entryId, opts) => this.openNote(entryId, opts.newLeaf),
      onHoverCard: (entryId, targetEl, event) =>
        this.previewNote(entryId, targetEl, event),
      onUndoMove: (expectedEntryId) => this.undoLastMove(expectedEntryId),
      registerPendingDropper: (drop) => {
        this.pendingDropper = drop;
      },
    };
    // データ到着前は loading シェルを描画し、onDataUpdated で実データに差し替える。
    render(this.viewContainerEl, {
      state: "loading",
      entries: [],
      placements: emptyPlacements(),
      presentation: resolvePresentation(getSettings(), getMessages()),
    });
  }

  onDataUpdated(): void {
    this.renderCurrent();
  }

  /**
   * 現在の `this.data`・設定・言語で再描画する（#23 F6）。`onDataUpdated`（Bases のデータ更新）と
   * `refresh`（設定変更時のプラグイン起点の再描画）が共有する。this.data が無い異常状態でも
   * 落とさず空シェルを描く（防御的アクセス）。
   */
  private renderCurrent(): void {
    render(
      this.viewContainerEl,
      toViewModel(
        this.data?.data,
        this.config,
        this.getSettings(),
        this.getMessages(),
        Date.now(),
        todayIso(),
      ),
      this.callbacks,
    );
  }

  /** 設定変更後に最新設定/言語で即時再描画する（プラグインが登録簿経由で呼ぶ・AC1/AC2）。 */
  refresh(): void {
    this.renderCurrent();
  }

  onunload(): void {
    this.registry?.delete(this);
    this.pendingDropper = null;
    unmount(this.viewContainerEl);
  }

  /**
   * ビュー内の楽観オーバーレイ（pending）を `entryId` 単位で落とす（#6）。
   * コマンド経由 undo（`main.ts`）が復元後に呼び、frontmatter は戻ったのにカードが誤象限へ貼り付く
   * 残存（トースト経路は UI 内で落とすが、コマンド経路はコンポーネントを経由しない非対称）を解消する。
   * UI 未マウント（`pendingDropper===null`）や該当 pending 無しは no-op。
   */
  dropPendingOverlay(entryId: string): void {
    this.pendingDropper?.(entryId);
  }

  /**
   * `entryId`（=file.path）から操作対象の `TFile` を解決する（書き戻し #20／オープン #22 で共通）。
   * 見つからなければ `notFoundMessage`（解決済み言語の Notice 本文）で `Notice` を出して `null` を返す
   *（呼び出し側は移動なら throw でロールバック、オープンなら return と制御を分ける）。
   */
  private resolveTargetFile(entryId: string, notFoundMessage: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(entryId);
    if (file instanceof TFile) return file;
    new Notice(`Eisenhower Matrix: ${notFoundMessage}`);
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
    const messages = this.getMessages();
    const keys = resolveWritableAxisKeys(this.config, this.getSettings());
    if (keys === null) {
      new Notice(`Eisenhower Matrix: ${messages.axisNotWritable}`);
      throw new Error("axis property is not writable (formula/file)");
    }

    const file = this.resolveTargetFile(entryId, messages.fileNotFoundForMove);
    if (!file) {
      throw new Error(`target file not found: ${entryId}`);
    }

    // 上書き前の両軸値を捕捉して undo 記録を組む（present/absent を区別・値は verbatim 保持）。
    // 書き込み成功後に UndoManager へ「直前 1 手」として保存する（undo・最小実装）。
    let undoRecord: UndoRecord | null = null;
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: FrontmatterLike) => {
        undoRecord = {
          entryId,
          title: file.basename,
          keys,
          previous: capturePreviousAxes(frontmatter, keys),
          // 書き込んだ両軸値を保持する（undo 適用前の同一性照合＝別ノートへの誤 delete/上書き防止）。
          wrote: { urgent: axisValues.urgent, important: axisValues.important },
        };
        frontmatter[keys.urgent] = axisValues.urgent;
        frontmatter[keys.important] = axisValues.important;
      });
    } catch (error) {
      console.error("[Eisenhower Matrix] failed to write back frontmatter", error);
      new Notice(`Eisenhower Matrix: ${messages.writeBackFailed}`);
      throw error;
    }
    if (undoRecord) this.undoManager?.record(undoRecord);
  }

  /**
   * 直前 1 手の移動を元に戻す（undo・最小実装）。ビュー内トースト（`onUndoMove`）と
   * コマンド（`main.ts`）が共有する {@link runUndo} へ委譲する（`UndoManager` の記録を復元）。
   * トースト起動時は名指しノートの `expectedEntryId` を渡し、記録が別の移動へ置き換わっていたら戻さない。
   */
  private undoLastMove(expectedEntryId?: string): void {
    if (!this.undoManager) return;
    void runUndo(this.app, this.undoManager, this.getMessages(), expectedEntryId);
  }

  /**
   * カードのノートを開く（#22 F5・AC1/AC2/AC4）。
   *
   * `entryId`（=file.path）から `TFile` を解決し、`newLeaf`（Cmd/Ctrl+ で true）に応じて
   * 現在のリーフ（`false`）または新規タブ（`"tab"`）で開く。ファイル欠落時は `Notice`（読みと同系統の防御）。
   * UI は `obsidian` 型に触れず、`workspace` 操作はここ（アダプタ）に隔離する（AC5）。
   */
  private openNote(entryId: string, newLeaf: boolean): void {
    const file = this.resolveTargetFile(entryId, this.getMessages().fileNotFoundForOpen);
    if (!file) return;
    // openFile は Promise を返す。resolveTargetFile 後にファイルが消える等で reject しうるため、
    // 握りつぶさず catch して通知する（未処理 rejection と無言失敗を防ぐ＝書き戻し経路と同じ扱い・レビュー指摘）。
    void this.app.workspace
      .getLeaf(newLeaf ? "tab" : false)
      .openFile(file)
      .catch((error) => {
        console.error("[Eisenhower Matrix] failed to open the note", error);
        new Notice(`Eisenhower Matrix: ${this.getMessages().openFailed}`);
      });
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
