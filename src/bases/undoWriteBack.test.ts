import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, TFile } from "../test-support/obsidianStub";
import { runUndo } from "./undoWriteBack";
import { UndoManager, type UndoRecord } from "../logic/undo";
import { messagesFor } from "../i18n";

/**
 * runUndo — 「直前 1 手」を frontmatter へ復元する共有経路（コマンド／ビュー内トースト）の
 * **呼び出し側ガードと分岐**を app（vault/fileManager）モックで固定する。純ロジック（applyUndo/
 * UndoManager）は undo.test.ts で担保済みだが、ここは「陳腐化トーストで別ノートを誤って戻さない
 * （expectedEntryId 不一致ガード）」「file 未解決で記録破棄」「書込失敗で記録保持」という、回帰すると
 * データ隣接の破壊になりうる分岐を守る（プロジェクトの「純判定を単体で固定」流儀の undo 版）。
 *
 * Notice/TFile は obsidian ランタイム値のためスタブを直接 import する（vitest が本番コードの
 * `import ... from "obsidian"` を同一スタブへ解決するため、`instanceof TFile` と `new Notice` の
 * 記録が本番経路と一致する）。
 */

const messages = messagesFor("ja");

function makeRecord(entryId = "a.md"): UndoRecord {
  return {
    entryId,
    title: "タスクA",
    keys: { urgent: "urgent", important: "important" },
    // 移動前: urgent は absent（復元で delete）・important は true（復元で代入）
    previous: { urgent: { present: false }, important: { present: true, value: true } },
  };
}

/** app モック。getAbstractFileByPath と processFrontMatter を差し替え可能にする。 */
function makeApp(opts: {
  file?: unknown;
  frontmatter?: Record<string, unknown>;
  throwOnWrite?: boolean;
}) {
  const processFrontMatter = vi.fn(
    async (_file: unknown, cb: (fm: Record<string, unknown>) => void) => {
      if (opts.throwOnWrite) throw new Error("write failed");
      cb(opts.frontmatter ?? {});
    },
  );
  const getAbstractFileByPath = vi.fn(() => opts.file ?? null);
  const app = {
    vault: { getAbstractFileByPath },
    fileManager: { processFrontMatter },
  } as unknown as App;
  return { app, processFrontMatter, getAbstractFileByPath };
}

beforeEach(() => Notice.reset());
afterEach(() => vi.restoreAllMocks());

describe("runUndo — 陳腐化トーストガード（expectedEntryId）", () => {
  it("runUndo — 記録が無ければ noUndo Notice で止め、書き込まない", async () => {
    // given
    const undo = new UndoManager();
    const { app, processFrontMatter } = makeApp({});
    // when
    await runUndo(app, undo, messages);
    // then
    expect(Notice.messages.some((m) => m.includes(messages.noUndo))).toBe(true);
    expect(processFrontMatter).not.toHaveBeenCalled();
  });

  it("runUndo — expectedEntryId が現記録と不一致なら noUndo で止め、別ノートを戻さず記録を保持する", async () => {
    // given: 記録は B の移動。古いトーストは A を名指し（複数ビューで記録が置き換わった状況）
    const undo = new UndoManager();
    undo.record(makeRecord("B.md"));
    const { app, processFrontMatter } = makeApp({ file: new TFile("B.md") });
    // when: A の undo を要求（陳腐化）
    await runUndo(app, undo, messages, "A.md");
    // then: B を誤って戻さない（processFrontMatter 未呼び出し）・記録は保持される（noUndo）
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(Notice.messages.some((m) => m.includes(messages.noUndo))).toBe(true);
    expect(undo.peek()?.entryId).toBe("B.md");
  });

  it("runUndo — expectedEntryId が一致すれば復元し記録を消す（present は代入・absent は delete）", async () => {
    // given
    const undo = new UndoManager();
    undo.record(makeRecord("a.md"));
    const frontmatter: Record<string, unknown> = { urgent: true, important: false };
    const { app, processFrontMatter } = makeApp({ file: new TFile("a.md"), frontmatter });
    // when
    await runUndo(app, undo, messages, "a.md");
    // then: applyUndo が適用される（urgent は absent→delete、important は true→代入）
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect("urgent" in frontmatter).toBe(false);
    expect(frontmatter.important).toBe(true);
    expect(undo.hasRecord()).toBe(false); // 成功で clear
    expect(Notice.messages.some((m) => m.includes(messages.undone("タスクA")))).toBe(true);
  });

  it("runUndo — expectedEntryId 省略（コマンド起動）は無条件に直前 1 手を戻す", async () => {
    // given
    const undo = new UndoManager();
    undo.record(makeRecord("a.md"));
    const { app, processFrontMatter } = makeApp({ file: new TFile("a.md"), frontmatter: {} });
    // when: expectedEntryId なし
    await runUndo(app, undo, messages);
    // then
    expect(processFrontMatter).toHaveBeenCalledTimes(1);
    expect(undo.hasRecord()).toBe(false);
  });
});

describe("runUndo — file 未解決・書込失敗の分岐", () => {
  it("runUndo — 対象が TFile として解決できなければ記録を捨てて undoFailed", async () => {
    // given: getAbstractFileByPath が null（ファイル削除等）
    const undo = new UndoManager();
    undo.record(makeRecord("gone.md"));
    const { app, processFrontMatter } = makeApp({ file: null });
    // when
    await runUndo(app, undo, messages);
    // then: 書き込まず、繰り返し失敗しないよう clear、undoFailed 通知
    expect(processFrontMatter).not.toHaveBeenCalled();
    expect(undo.hasRecord()).toBe(false);
    expect(Notice.messages.some((m) => m.includes(messages.undoFailed("タスクA")))).toBe(true);
  });

  it("runUndo — processFrontMatter が例外なら undoFailed（記録は保持し再試行余地を残す）", async () => {
    // given
    const undo = new UndoManager();
    undo.record(makeRecord("a.md"));
    const { app } = makeApp({ file: new TFile("a.md"), throwOnWrite: true });
    // when
    await runUndo(app, undo, messages);
    // then: catch では clear しない（記録保持）・undoFailed 通知
    expect(Notice.messages.some((m) => m.includes(messages.undoFailed("タスクA")))).toBe(true);
    expect(undo.hasRecord()).toBe(true);
  });
});
