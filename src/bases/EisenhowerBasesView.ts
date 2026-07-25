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
import { resolveCompletionKey, resolveWritableAxisKeys } from "./readAxis";
import { resolveNumberThresholds } from "./numberThreshold";
import { resolveTagNames } from "./tagAxis";
import { planWriteBack } from "./writeBackPlan";
import { runUndo } from "./undoWriteBack";
import { VIEW_ID } from "./registerView";
import {
  buildUndoEntries,
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
      onToggleCompletion: (entryId, done) => this.writeCompletion(entryId, done),
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
   * ドラッグ書き戻し（#20 F3・#122 1b で数値しきい値軸へ一般化）: 目標両軸 side を `planWriteBack`
   *（#122・純関数）に通し、**書き込みが要る軸だけ**を frontmatter へ明示書き込みする（`delete` しない）。
   *
   * 軸 propertyId を解決し（ビュー options 主・設定デフォルト）、`note.<key>` のキーへ
   * `app.fileManager.processFrontMatter` で書く。**boolean 軸は両軸 `true/false` を無条件書き込み（v1 挙動
   * 不変・AC4）。数値しきい値軸は越境時のみ代表値を書き、同じ側なら書かない（数値温存・AC1/AC2）。absent の
   * 数値軸は両軸に代表値を書く（新規分類・AC5）。** `note.` 以外（formula/file）やファイル欠落・書き込み失敗は
   * `Notice` を出して reject し、UI 側に楽観移動のロールバックを促す。
   */
  private async writeBackAxes(
    entryId: string,
    axisValues: AxisWriteValues,
  ): Promise<void> {
    // 書込可能な note.* 軸か（両軸）を frontmatter に触れる前に判定して弾く（AC3）。
    const messages = this.getMessages();
    const settings = this.getSettings();
    // タグ軸（#125）: per-axis tagName を解決し、書き戻しキー解決（同一キー kind-aware）と
    // 書き込みプラン（tag add/remove）の双方へ渡す（読み取り側 toViewModel と同期）。
    const tagNames = resolveTagNames(this.config, settings);
    const keys = resolveWritableAxisKeys(this.config, settings, tagNames);
    if (keys === null) {
      new Notice(`Eisenhower Matrix: ${messages.axisNotWritable}`);
      throw new Error("axis property is not writable (formula/file)");
    }
    // 数値しきい値軸の per-axis しきい値を解決する（#121・null＝boolean 軸扱い＝v1 挙動不変）。
    const thresholds = resolveNumberThresholds(this.config, settings);

    const file = this.resolveTargetFile(entryId, messages.fileNotFoundForMove);
    if (!file) {
      throw new Error(`target file not found: ${entryId}`);
    }

    // 上書き前の値を捕捉して undo 記録を組む（present/absent を区別・値は verbatim 保持＝数値もそのまま）。
    // 書き込み成功後に UndoManager へ「直前 1 手」として保存する（undo・最小実装）。
    // なお writeCompletion と違い、ここは非 boolean 実値の inline ガード（書込阻止）を持たない。これは
    // 意図的な非対称: (1) 非 boolean・非対応値のカードは render 時に軸読み取り（`toViewModel` が見る
    // `readAxisReadings(...).locked`・#121）でロック＝ドラッグ不可のため通常経路では到達しない。
    // (2) 稀な in-flight ドラッグ中の外部書換で非対応化しても、上書き前の値をこの undo 記録が verbatim
    // 捕捉するため復元可能。writeCompletion は undo を作らないので元値保護を inline ガードで担う＝両経路は
    // 「undo 復元／書込阻止」で守り方が異なる（v0.2 レビュー）。
    let undoRecord: UndoRecord | null = null;
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: FrontmatterLike) => {
        // per-axis で planAxisWrite を通し、越境した軸だけを書き込みリストにする（同側の数値は温存・#122 1b）。
        const writes = planWriteBack(frontmatter, keys, axisValues, thresholds, tagNames);
        // 両軸とも温存（数値が同側）で書くものが無ければ何もせず、直前の undo 記録も据え置く（#122 レビュー）。
        // 到達は TOCTOU 限定（render 後〜drop 前に外部編集で数値が既に目標側へ移動し、UI の shouldSkipMove は
        // 旧 side で「移動」と判断するが planWriteBack は越境なしと判断する食い違い）。この分岐は書き込みを
        // 行わないためデータ破壊は無く、新規 undo を記録しないのも正しい（戻す対象が無い）。直前の記録を消さ
        // ないのは意図的＝過去の実書き込みは依然 undo 可能に保つ（トースト経由 undo は runUndo の
        // expectedEntryId ガードが別ノートの誤復元を防ぐ）。「書かなかったのに成功トーストが出る」楽観
        // オーバーレイの UX 齟齬は optimistic + 温存 設計に内在し、完全な解消は onMoveCard が「書いたか」を
        // 返す UI 契約変更（1b の src/ui 差分 0 件方針を崩す）を要するため、数値軸 GUI 段で総合的に扱う。
        if (writes.length === 0) return;
        // 書いた軸だけを 1 記録に捕捉する（#105 keylist）。書き込んだ値（value）は undo 適用前の同一性照合
        //（別ノートへの誤 delete/上書き防止）に使う。boolean 両軸＝2 要素・数値片側温存＝1 要素。
        undoRecord = {
          entryId,
          title: file.basename,
          entries: buildUndoEntries(frontmatter, writes),
        };
        for (const write of writes) {
          frontmatter[write.key] = write.value;
        }
      });
    } catch (error) {
      console.error("[Eisenhower Matrix] failed to write back frontmatter", error);
      new Notice(`Eisenhower Matrix: ${messages.writeBackFailed}`);
      throw error;
    }
    if (undoRecord) this.undoManager?.record(undoRecord);
  }

  /**
   * カード上の完了トグル（#105 F10）: 完了プロパティへ単一 boolean を明示書き込みする（`true`⇄`false`・
   * `delete` しない＝双方向トグル）。書込前に**非 boolean 値（日付型等）は上書きしない**で元値を守り
   *（AC2・UI の disabled と二重化）、`processFrontMatter` のコールバック内で undo 記録（entries 1 要素）を
   * 組む。書き戻し（`writeBackAxes`）と同じく `getValue` を経由せず生 frontmatter を書く。成功後に
   * `UndoManager` へ「直前 1 手」として保存し、成功/失敗/非対応を `Notice` で通知する。完了ノートの
   * 表示/非表示は Base の `done != true` フィルタ（+ `onDataUpdated` 再クエリ）に委譲する。
   */
  private async writeCompletion(entryId: string, done: boolean): Promise<boolean> {
    const messages = this.getMessages();
    const completionKey = resolveCompletionKey(this.config, this.getSettings());
    if (completionKey === null) {
      // 完了プロパティ未設定/無効（非 note.*・軸衝突）。UI はボタンを出さない前提だが防御的に弾く。
      new Notice(`Eisenhower Matrix: ${messages.completionFailed(entryId)}`);
      throw new Error("completion property is not writable");
    }

    // 完了トグルの file 欠落は「移動」ではなく「完了状態を変更できない」旨で通知する（gemini 指摘）。
    const file = this.resolveTargetFile(entryId, messages.fileNotFoundForCompletion);
    if (!file) {
      throw new Error(`target file not found: ${entryId}`);
    }

    let undoRecord: UndoRecord | null = null;
    let unsupported = false;
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: FrontmatterLike) => {
        const existing = frontmatter[completionKey];
        // 非 boolean の**実値**（日付型等）は上書きせず元値を守る（AC2・破壊防止）。absent（未定義）・
        // 明示 null（空値）は新規に書けるため許可する＝読み取り側 `readCompletionState`（null/absent を
        // 書ける と判定しボタンを有効化）と対称にする（`!= null` で undefined と null の両方を許可・レビュー指摘）。
        if (existing != null && typeof existing !== "boolean") {
          unsupported = true;
          return;
        }
        undoRecord = {
          entryId,
          title: file.basename,
          entries: buildUndoEntries(frontmatter, [{ key: completionKey, value: done }]),
        };
        frontmatter[completionKey] = done;
      });
    } catch (error) {
      console.error("[Eisenhower Matrix] failed to write completion frontmatter", error);
      new Notice(`Eisenhower Matrix: ${messages.completionFailed(file.basename)}`);
      throw error;
    }
    if (unsupported) {
      // 非 boolean を検出して書き込まなかった（元値を破壊していない）。undo 記録も作らない。
      // `false`（＝保護・未書込）を返し、呼び出し側が「完了しました」ではなく「保護中」を通知できるようにする
      //（aria-live へ偽成功を流さない・レビュー指摘）。
      new Notice(`Eisenhower Matrix: ${messages.completionUnsupported}`);
      return false;
    }
    if (undoRecord) this.undoManager?.record(undoRecord);
    new Notice(`Eisenhower Matrix: ${messages.completionSucceeded(file.basename, done)}`);
    return true;
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
