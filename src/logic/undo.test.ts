import { describe, expect, it } from "vitest";
import {
  UndoManager,
  applyUndo,
  buildUndoEntries,
  capturePreviousValue,
  isUndoApplicable,
  type FrontmatterLike,
  type UndoRecord,
} from "./undo";

/**
 * undo 純ロジック（直前 1 手の「元に戻す」）。#105 で記録形式を 2 軸固定形から
 * **キーリスト形（`entries: UndoEntry[]`）** へ一般化した（ドラッグ書き戻し＝2 要素／完了トグル＝1 要素が
 * 同じ機構を共有する）。捕捉（build）と復元（apply）の可逆性、absent/present の区別、非 boolean 値の
 * verbatim 保持、値照合、UndoManager の 1 手保持を固定する。
 */

/** 2 軸移動の記録を組む（ドラッグ書き戻し相当）。 */
function axisRecord(
  entryId: string,
  previous: { urgent: UndoRecord["entries"][number]["previous"]; important: UndoRecord["entries"][number]["previous"] },
  wrote: { urgent: boolean; important: boolean },
): UndoRecord {
  return {
    entryId,
    title: entryId.replace(/\.md$/, ""),
    entries: [
      { key: "urgent", previous: previous.urgent, wrote: wrote.urgent },
      { key: "important", previous: previous.important, wrote: wrote.important },
    ],
  };
}

describe("capturePreviousValue — 移動前の 1 キー捕捉", () => {
  it("capturePreviousValue — キーが存在すれば present で値を保持する（true）", () => {
    // given
    const frontmatter: FrontmatterLike = { urgent: true };
    // when
    const previous = capturePreviousValue(frontmatter, "urgent");
    // then
    expect(previous).toEqual({ present: true, value: true });
  });

  it("capturePreviousValue — 値が false でも present（absent と区別する）", () => {
    // given
    const frontmatter: FrontmatterLike = { important: false };
    // when / then
    expect(capturePreviousValue(frontmatter, "important")).toEqual({
      present: true,
      value: false,
    });
  });

  it("capturePreviousValue — キーが無ければ absent（present:false）", () => {
    // given / when / then
    expect(capturePreviousValue({}, "urgent")).toEqual({ present: false });
  });

  it("capturePreviousValue — 値が undefined でもキーが存在すれば present（hasOwnProperty 判定）", () => {
    // given: キーはあるが値が undefined
    const frontmatter: FrontmatterLike = { urgent: undefined };
    // when / then: absent（present:false）ではなく present:true として捕捉する
    expect(capturePreviousValue(frontmatter, "urgent")).toEqual({
      present: true,
      value: undefined,
    });
  });

  it("capturePreviousValue — 非 boolean 値（数値/文字列）も verbatim で保持する", () => {
    // given
    const frontmatter: FrontmatterLike = { urgent: 3, important: "high" };
    // when / then
    expect(capturePreviousValue(frontmatter, "urgent")).toEqual({
      present: true,
      value: 3,
    });
    expect(capturePreviousValue(frontmatter, "important")).toEqual({
      present: true,
      value: "high",
    });
  });
});

describe("buildUndoEntries — 書き込み前の複数キー捕捉（#105 一般化）", () => {
  it("buildUndoEntries — 各キーの present/absent を捕捉し、書き込む値（wrote）を対にする（2 軸）", () => {
    // given: urgent は present(false)・important は absent の未分類カードを Do（true/true）へ移動
    const frontmatter: FrontmatterLike = { urgent: false };
    // when
    const entries = buildUndoEntries(frontmatter, [
      { key: "urgent", value: true },
      { key: "important", value: true },
    ]);
    // then: キー順どおり、previous は捕捉値・wrote は書き込む値
    expect(entries).toEqual([
      { key: "urgent", previous: { present: true, value: false }, wrote: true },
      { key: "important", previous: { present: false }, wrote: true },
    ]);
  });

  it("buildUndoEntries — 単一キー（完了トグル）も同じ機構で 1 要素の entries を組む（#105 F10）", () => {
    // given: done 未定義のノートを完了（done:true）にする
    const frontmatter: FrontmatterLike = { title: "x" };
    // when
    const entries = buildUndoEntries(frontmatter, [{ key: "done", value: true }]);
    // then: 単一要素・absent 捕捉・wrote=true（undo で done を delete して未完了へ戻せる）
    expect(entries).toEqual([{ key: "done", previous: { present: false }, wrote: true }]);
  });

  it("buildUndoEntries — 完了解除（done:false 明示書き込み）も前値を捕捉する（双方向トグル）", () => {
    // given: done:true のノートを未完了（done:false）へ戻す
    const frontmatter: FrontmatterLike = { done: true };
    // when
    const entries = buildUndoEntries(frontmatter, [{ key: "done", value: false }]);
    // then: 前値 true を present で保持し、wrote=false
    expect(entries).toEqual([{ key: "done", previous: { present: true, value: true }, wrote: false }]);
  });
});

describe("applyUndo — 移動前の状態へ復元（mutate・キーリスト）", () => {
  it("applyUndo — present の軸は値を代入して戻す（別象限からの移動）", () => {
    // given: 移動前は Schedule（urgent=false, important=true）だったカードが Do（true/true）へ
    const record = axisRecord(
      "task.md",
      { urgent: { present: true, value: false }, important: { present: true, value: true } },
      { urgent: true, important: true },
    );
    const frontmatter: FrontmatterLike = { urgent: true, important: true };
    // when
    applyUndo(frontmatter, record);
    // then: 移動前の値へ戻る
    expect(frontmatter).toEqual({ urgent: false, important: true });
  });

  it("applyUndo — absent の軸はキーを delete して未分類（absent）へ戻す（完全復元）", () => {
    // given: 未分類（両軸 absent）から Do へ移動され、現在は true/true
    const record = axisRecord(
      "note.md",
      { urgent: { present: false }, important: { present: false } },
      { urgent: true, important: true },
    );
    const frontmatter: FrontmatterLike = { urgent: true, important: true, other: "keep" };
    // when
    applyUndo(frontmatter, record);
    // then: 両軸キーが消え（未分類へ）、無関係なキーは残す
    expect("urgent" in frontmatter).toBe(false);
    expect("important" in frontmatter).toBe(false);
    expect(frontmatter).toEqual({ other: "keep" });
  });

  it("applyUndo — 単一キー（完了トグル）の undo は done を前状態へ戻す（#105 F10）", () => {
    // given: done 未定義のノートを done:true にした → undo で done を delete して未完了へ
    const record: UndoRecord = {
      entryId: "done.md",
      title: "done",
      entries: [{ key: "done", previous: { present: false }, wrote: true }],
    };
    const frontmatter: FrontmatterLike = { done: true, keep: 1 };
    // when
    applyUndo(frontmatter, record);
    // then: done は消え未完了へ、無関係なキーは残す（他軸には触れない＝単一キー）
    expect("done" in frontmatter).toBe(false);
    expect(frontmatter).toEqual({ keep: 1 });
  });

  it("applyUndo — 非 boolean の元値も verbatim で復元する（データ破壊を残さない）", () => {
    // given: urgent が数値 5 だったカードが Do へ移動され true/true になっている
    const record = axisRecord(
      "num.md",
      { urgent: { present: true, value: 5 }, important: { present: false } },
      { urgent: true, important: true },
    );
    const frontmatter: FrontmatterLike = { urgent: true, important: true };
    // when
    applyUndo(frontmatter, record);
    // then: 元の数値 5 に戻り important は delete
    expect(frontmatter).toEqual({ urgent: 5 });
  });

  it("build → applyUndo は往復で移動前の状態に一致する（可逆性・2 軸）", () => {
    // given: 移動前の frontmatter
    const before: FrontmatterLike = { important: false, tag: "x" };
    const entries = buildUndoEntries(before, [
      { key: "urgent", value: true },
      { key: "important", value: true },
    ]);
    // when: 書き戻し（Do へ）で両軸を true にした後、undo で復元
    const after: FrontmatterLike = { important: true, tag: "x", urgent: true };
    applyUndo(after, { entryId: "r.md", title: "r", entries });
    // then: 移動前と一致（urgent は absent へ戻り important は false へ）
    expect(after).toEqual(before);
  });
});

describe("isUndoApplicable — 復元前の同一性照合（別ノートへの誤 delete/上書き防止・全キー一致）", () => {
  const recordFor = (wrote: { urgent: boolean; important: boolean }): UndoRecord =>
    axisRecord(
      "a.md",
      { urgent: { present: false }, important: { present: false } },
      wrote,
    );

  it("isUndoApplicable — 全キーが書き込んだ値のままなら true（正常な undo 対象）", () => {
    // given: 移動で両軸に true/true を書き込み、現状もそのまま
    const frontmatter: FrontmatterLike = { urgent: true, important: true };
    // when / then
    expect(isUndoApplicable(frontmatter, recordFor({ urgent: true, important: true }))).toBe(true);
  });

  it("isUndoApplicable — パス再利用で別ノートの非 boolean データが載っていたら false（誤適用しない）", () => {
    // given: 移動後に a.md が別ノートで作り直され、実データ（数値/文字列）を持つ
    const frontmatter: FrontmatterLike = { urgent: 5, important: "high" };
    // when / then: 書き込んだ true/true と一致しないため復元対象にしない（delete で数値/文字列を消さない）
    expect(isUndoApplicable(frontmatter, recordFor({ urgent: true, important: true }))).toBe(false);
  });

  it("isUndoApplicable — 一部キーだけ外部で書き換えられていても false（部分不一致も弾く＝every）", () => {
    // given: urgent は書いた値のままだが important がユーザーにより false へ変更されている
    const frontmatter: FrontmatterLike = { urgent: true, important: false };
    // when / then
    expect(isUndoApplicable(frontmatter, recordFor({ urgent: true, important: true }))).toBe(false);
  });

  it("isUndoApplicable — 単一キー完了トグルも書き込んだ値のままなら true・改変なら false（#105）", () => {
    const record: UndoRecord = {
      entryId: "c.md",
      title: "c",
      entries: [{ key: "done", previous: { present: false }, wrote: true }],
    };
    expect(isUndoApplicable({ done: true }, record)).toBe(true);
    // 完了後にユーザーが日付型へ書き換えた等 → 誤適用（delete）しない
    expect(isUndoApplicable({ done: "2026-07-06" }, record)).toBe(false);
    expect(isUndoApplicable({}, record)).toBe(false);
  });
});

describe("UndoManager — 直前 1 手の保持", () => {
  const recordOf = (entryId: string): UndoRecord =>
    axisRecord(
      entryId,
      { urgent: { present: false }, important: { present: false } },
      { urgent: true, important: true },
    );

  it("初期状態は記録なし", () => {
    const manager = new UndoManager();
    expect(manager.hasRecord()).toBe(false);
    expect(manager.peek()).toBeNull();
  });

  it("record → peek で記録を取り出せる（消費はしない）", () => {
    const manager = new UndoManager();
    manager.record(recordOf("a.md"));
    expect(manager.hasRecord()).toBe(true);
    expect(manager.peek()?.entryId).toBe("a.md");
    expect(manager.peek()?.entryId).toBe("a.md");
  });

  it("新しい record は前の記録を上書きする（保持は 1 手のみ）", () => {
    const manager = new UndoManager();
    manager.record(recordOf("a.md"));
    manager.record(recordOf("b.md"));
    expect(manager.peek()?.entryId).toBe("b.md");
  });

  it("clear で記録を空にする", () => {
    const manager = new UndoManager();
    manager.record(recordOf("a.md"));
    manager.clear();
    expect(manager.hasRecord()).toBe(false);
    expect(manager.peek()).toBeNull();
  });

  it("clearIfEntry — 記録が指す path と一致すれば破棄して true（削除/リネームでのパス無効化）", () => {
    const manager = new UndoManager();
    manager.record(recordOf("a.md"));
    const cleared = manager.clearIfEntry("a.md");
    expect(cleared).toBe(true);
    expect(manager.hasRecord()).toBe(false);
  });

  it("clearIfEntry — 別 path なら何もせず false（無関係なファイル操作で記録を消さない）", () => {
    const manager = new UndoManager();
    manager.record(recordOf("a.md"));
    const cleared = manager.clearIfEntry("b.md");
    expect(cleared).toBe(false);
    expect(manager.peek()?.entryId).toBe("a.md");
  });

  it("clearIfEntry — 記録が無ければ false", () => {
    const manager = new UndoManager();
    expect(manager.clearIfEntry("a.md")).toBe(false);
  });

  it("clearIfEntry — 親フォルダの削除/リネームで配下ノートの記録を破棄する（フォルダは 1 件のイベント・Gemini 指摘）", () => {
    const manager = new UndoManager();
    manager.record(recordOf("Folder/Note.md"));
    const cleared = manager.clearIfEntry("Folder");
    expect(cleared).toBe(true);
    expect(manager.hasRecord()).toBe(false);
  });

  it("clearIfEntry — 前方一致するだけの兄弟フォルダでは破棄しない（Folder2 は Folder 配下ではない）", () => {
    const manager = new UndoManager();
    manager.record(recordOf("Folder2/Note.md"));
    const cleared = manager.clearIfEntry("Folder");
    expect(cleared).toBe(false);
    expect(manager.peek()?.entryId).toBe("Folder2/Note.md");
  });
});
