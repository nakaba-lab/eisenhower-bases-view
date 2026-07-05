import { describe, expect, it } from "vitest";
import {
  UndoManager,
  applyUndo,
  capturePreviousAxes,
  capturePreviousValue,
  isUndoApplicable,
  type FrontmatterLike,
  type UndoRecord,
} from "./undo";

/**
 * undo 純ロジック（直前 1 手の「元に戻す」）。捕捉（capture）と復元（apply）の可逆性、
 * absent/present の区別、非 boolean 値の verbatim 保持、UndoManager の 1 手保持を固定する。
 */

const KEYS = { urgent: "urgent", important: "important" };

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

describe("capturePreviousAxes — 両軸捕捉", () => {
  it("capturePreviousAxes — 両軸の present/absent を個別に捕捉する", () => {
    // given: urgent は present(false)・important は absent
    const frontmatter: FrontmatterLike = { urgent: false };
    // when
    const previous = capturePreviousAxes(frontmatter, KEYS);
    // then
    expect(previous).toEqual({
      urgent: { present: true, value: false },
      important: { present: false },
    });
  });
});

describe("applyUndo — 移動前の状態へ復元（mutate）", () => {
  it("applyUndo — present の軸は値を代入して戻す（別象限からの移動）", () => {
    // given: 移動前は Schedule（urgent=false, important=true）だったカードが
    //        Do（true/true）へ移動され、現在の frontmatter は true/true
    const record: UndoRecord = {
      entryId: "task.md",
      title: "task",
      keys: KEYS,
      previous: {
        urgent: { present: true, value: false },
        important: { present: true, value: true },
      },
      wrote: { urgent: true, important: true },
    };
    const frontmatter: FrontmatterLike = { urgent: true, important: true };
    // when
    applyUndo(frontmatter, record);
    // then: 移動前の値へ戻る
    expect(frontmatter).toEqual({ urgent: false, important: true });
  });

  it("applyUndo — absent の軸はキーを delete して未分類（absent）へ戻す（完全復元）", () => {
    // given: 未分類（両軸 absent）から Do へ移動され、現在は true/true
    const record: UndoRecord = {
      entryId: "note.md",
      title: "note",
      keys: KEYS,
      previous: {
        urgent: { present: false },
        important: { present: false },
      },
      wrote: { urgent: true, important: true },
    };
    const frontmatter: FrontmatterLike = {
      urgent: true,
      important: true,
      other: "keep",
    };
    // when
    applyUndo(frontmatter, record);
    // then: 両軸キーが消え（未分類へ）、無関係なキーは残す
    expect("urgent" in frontmatter).toBe(false);
    expect("important" in frontmatter).toBe(false);
    expect(frontmatter).toEqual({ other: "keep" });
  });

  it("applyUndo — 片軸 absent・片軸 present の混在（未分類の片軸のみ設定）を正しく戻す", () => {
    // given: urgent のみ present(false)・important は absent だったカードが Do へ移動
    const record: UndoRecord = {
      entryId: "half.md",
      title: "half",
      keys: KEYS,
      previous: {
        urgent: { present: true, value: false },
        important: { present: false },
      },
      wrote: { urgent: true, important: true },
    };
    const frontmatter: FrontmatterLike = { urgent: true, important: true };
    // when
    applyUndo(frontmatter, record);
    // then: urgent は false へ、important は delete
    expect(frontmatter).toEqual({ urgent: false });
  });

  it("applyUndo — 非 boolean の元値も verbatim で復元する（データ破壊を残さない）", () => {
    // given: urgent が数値 5 だったカードが Do へ移動され true/true になっている
    const record: UndoRecord = {
      entryId: "num.md",
      title: "num",
      keys: KEYS,
      previous: {
        urgent: { present: true, value: 5 },
        important: { present: false },
      },
      wrote: { urgent: true, important: true },
    };
    const frontmatter: FrontmatterLike = { urgent: true, important: true };
    // when
    applyUndo(frontmatter, record);
    // then: 元の数値 5 に戻り important は delete
    expect(frontmatter).toEqual({ urgent: 5 });
  });

  it("capture → applyUndo は往復で移動前の状態に一致する（可逆性）", () => {
    // given: 移動前の frontmatter
    const before: FrontmatterLike = { important: false, tag: "x" };
    const previous = capturePreviousAxes(before, KEYS);
    // when: 書き戻し（Do へ）で両軸を true にした後、undo で復元
    const after: FrontmatterLike = { important: true, tag: "x", urgent: true };
    applyUndo(after, {
      entryId: "r.md",
      title: "r",
      keys: KEYS,
      previous,
      wrote: { urgent: true, important: true },
    });
    // then: 移動前と一致（urgent は absent へ戻り important は false へ）
    expect(after).toEqual(before);
  });
});

describe("isUndoApplicable — 復元前の同一性照合（別ノートへの誤 delete/上書き防止）", () => {
  const recordFor = (wrote: { urgent: boolean; important: boolean }): UndoRecord => ({
    entryId: "a.md",
    title: "a",
    keys: KEYS,
    previous: { urgent: { present: false }, important: { present: false } },
    wrote,
  });

  it("isUndoApplicable — 両軸が書き込んだ値のままなら true（正常な undo 対象）", () => {
    // given: 移動で両軸に true/true を書き込み、現状もそのまま
    const frontmatter: FrontmatterLike = { urgent: true, important: true };
    // when / then
    expect(isUndoApplicable(frontmatter, recordFor({ urgent: true, important: true }))).toBe(
      true,
    );
  });

  it("isUndoApplicable — パス再利用で別ノートの非 boolean データが載っていたら false（誤適用しない）", () => {
    // given: 移動後に a.md が別ノートで作り直され、実データ（数値/文字列）を持つ
    const frontmatter: FrontmatterLike = { urgent: 5, important: "high" };
    // when / then: 書き込んだ true/true と一致しないため復元対象にしない（delete で数値/文字列を消さない）
    expect(isUndoApplicable(frontmatter, recordFor({ urgent: true, important: true }))).toBe(
      false,
    );
  });

  it("isUndoApplicable — 片軸だけ外部で書き換えられていても false（部分不一致も弾く）", () => {
    // given: urgent は書いた値のままだが important がユーザーにより false へ変更されている
    const frontmatter: FrontmatterLike = { urgent: true, important: false };
    // when / then
    expect(isUndoApplicable(frontmatter, recordFor({ urgent: true, important: true }))).toBe(
      false,
    );
  });

  it("isUndoApplicable — キーが消えている（軸が削除された）と false", () => {
    // given: 両軸キーが frontmatter から失われている
    const frontmatter: FrontmatterLike = {};
    // when / then
    expect(isUndoApplicable(frontmatter, recordFor({ urgent: false, important: false }))).toBe(
      false,
    );
  });
});

describe("UndoManager — 直前 1 手の保持", () => {
  const recordOf = (entryId: string): UndoRecord => ({
    entryId,
    title: entryId,
    keys: KEYS,
    previous: { urgent: { present: false }, important: { present: false } },
    wrote: { urgent: true, important: true },
  });

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
    // peek は消費しない
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
    // when: a.md が削除された想定
    const cleared = manager.clearIfEntry("a.md");
    // then: 記録を破棄（パス再利用への誤 undo を断つ）
    expect(cleared).toBe(true);
    expect(manager.hasRecord()).toBe(false);
  });

  it("clearIfEntry — 別 path なら何もせず false（無関係なファイル操作で記録を消さない）", () => {
    const manager = new UndoManager();
    manager.record(recordOf("a.md"));
    // when: 別ノート b.md の削除/リネーム
    const cleared = manager.clearIfEntry("b.md");
    // then: 記録は保持
    expect(cleared).toBe(false);
    expect(manager.peek()?.entryId).toBe("a.md");
  });

  it("clearIfEntry — 記録が無ければ false", () => {
    const manager = new UndoManager();
    expect(manager.clearIfEntry("a.md")).toBe(false);
  });
});
