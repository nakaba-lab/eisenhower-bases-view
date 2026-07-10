import { Notice, TFile, type App } from "obsidian";
import {
  applyUndo,
  type FrontmatterLike,
  isUndoApplicable,
  type UndoManager,
} from "../logic/undo";
import type { Messages } from "../i18n";

/**
 * 「直前 1 手の移動」を frontmatter へ復元する共有経路（undo・最小実装）。
 *
 * コマンド（`main.ts` の `addCommand`）とビュー内トースト（`EisenhowerBasesView.onUndoMove`）の
 * 双方がこれを呼び、復元ロジックを 1 箇所へ単一化する（重複させない）。`UndoManager` の記録を取り、
 * `TFile` を解決して `processFrontMatter` で {@link applyUndo}（present は代入・absent は delete）を適用する。
 * 記録が無ければ `Notice`（`messages.noUndo`）。成功で記録を消し（`clear`）、`onDataUpdated` 自動再発火で
 * 再配置される（手動再描画は不要）。`extends BasesView`／`app` 接触面のため単体テスト対象外（純ロジックの
 * `applyUndo`／`buildUndoEntries`／`UndoManager` を単体で固定し、この実機接触は手動/結合で担保する）。
 *
 * `expectedEntryId` を渡すと、**現在の記録がその entry の移動である場合のみ**戻す（トーストが特定ノートを
 * 名指しするため、複数ビュー併用で記録が別の移動に置き換わっていた場合に別ノートを誤って戻さないガード）。
 * 一致しなければ何もせず `Notice`（`noUndo`）を出す。省略時（コマンド起動）は「直前 1 手」を無条件に戻す。
 *
 * **戻り値**: 実際に frontmatter を復元した場合はその entryId（file.path）、復元しなかった場合（記録なし・
 * 名指し不一致・ファイル欠落・値不一致・書込失敗）は `null`。コマンド経由 undo の呼び出し側（`main.ts`）は
 * これを使って生存ビューの楽観オーバーレイを落とす（トースト経路との挙動対称化・レビュー指摘 #6）。
 */
export async function runUndo(
  app: App,
  undoManager: UndoManager,
  messages: Messages,
  expectedEntryId?: string,
): Promise<string | null> {
  const record = undoManager.peek();
  if (!record || (expectedEntryId != null && record.entryId !== expectedEntryId)) {
    // 記録が無い、または名指しの移動が既に別の移動へ置き換わっている（陳腐化したトースト）。
    new Notice(`Eisenhower Matrix: ${messages.noUndo}`);
    return null;
  }

  const file = app.vault.getAbstractFileByPath(record.entryId);
  if (!(file instanceof TFile)) {
    // 対象が消えている等で復元できない記録は破棄し、繰り返し失敗しないようにする。
    undoManager.clear();
    new Notice(`Eisenhower Matrix: ${messages.undoFailed(record.title)}`);
    return null;
  }

  try {
    // 記録した書き込み値が現状と一致する場合のみ復元する。移動後にパスが別ノートで再利用されたり、
    // 軸値が外部で書き換えられていた場合は、無関係なノートの frontmatter を上書き/delete しない
    // （undo は唯一の delete 経路のため、適用前に同一性を照合する＝レビュー指摘）。
    let applied = false;
    await app.fileManager.processFrontMatter(file, (frontmatter: FrontmatterLike) => {
      if (!isUndoApplicable(frontmatter, record)) return;
      applyUndo(frontmatter, record);
      applied = true;
    });
    // 成否に関わらず記録は消費する（陳腐化した記録を残して繰り返し誤適用しない）。
    undoManager.clear();
    new Notice(
      `Eisenhower Matrix: ${applied ? messages.undone(record.title) : messages.noUndo}`,
    );
    return applied ? record.entryId : null;
  } catch (error) {
    console.error("[Eisenhower Matrix] failed to restore frontmatter for undo", error);
    new Notice(`Eisenhower Matrix: ${messages.undoFailed(record.title)}`);
    return null;
  }
}
