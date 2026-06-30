import { describe, expect, it } from "vitest";
import type { MatrixEntry, QuadrantPlacements } from "../bases/types";
import {
  applyPendingMoves,
  reconcilePendingMoves,
  type PendingMoves,
} from "./optimisticMove";

/**
 * optimisticMove — ドラッグ書き戻し（#20 F3）の楽観更新＋ロールバックの純レデューサ。
 *
 * dnd-kit のドラッグ実操作は jsdom で再現困難なため、状態遷移（楽観適用・確定・
 * ロールバック）だけを Bases/dnd-kit 非依存の純関数として固める（DoD「軸値算出=単体、
 * DnD 往復=手動/結合」）。配線・実操作は手動/frontend-reviewer で担保する。
 */

function entry(
  id: string,
  title: string,
  urgent: boolean | undefined,
  important: boolean | undefined,
): MatrixEntry {
  return { id, title, urgent, important };
}

function emptyPlacements(): QuadrantPlacements {
  return { do: [], schedule: [], delegate: [], delete: [], unclassified: [] };
}

function placements(partial: Partial<QuadrantPlacements>): QuadrantPlacements {
  return { ...emptyPlacements(), ...partial };
}

describe("applyPendingMoves — 楽観移動の適用（AC1）", () => {
  it("applyPendingMoves — 保留が空なら placements をそのまま反映する（変更なし）", () => {
    // given
    const base = placements({ schedule: [entry("a.md", "a", false, true)] });
    const pending: PendingMoves = new Map();
    // when
    const result = applyPendingMoves(base, pending);
    // then
    expect(result.schedule.map((e) => e.id)).toEqual(["a.md"]);
    expect(result.do).toEqual([]);
  });

  it("applyPendingMoves — 保留移動で entry が目的象限へ移り両軸値が更新される", () => {
    // given: Schedule(false,true) のカードを Do(true,true) へ移す
    const base = placements({ schedule: [entry("a.md", "a", false, true)] });
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
    ]);
    // when
    const result = applyPendingMoves(base, pending);
    // then: Schedule から消え Do に現れ、軸値が true/true に更新される
    expect(result.schedule).toEqual([]);
    expect(result.do.map((e) => e.id)).toEqual(["a.md"]);
    expect(result.do[0]).toMatchObject({ urgent: true, important: true });
  });

  it("applyPendingMoves — 未分類カード（両軸 absent）を象限へ移動して分類できる（人間承認）", () => {
    // given: 未分類（両軸 undefined）のカードを Delegate(true,false) へ
    const base = placements({
      unclassified: [entry("u.md", "u", undefined, undefined)],
    });
    const pending: PendingMoves = new Map([
      ["u.md", { urgent: true, important: false }],
    ]);
    // when
    const result = applyPendingMoves(base, pending);
    // then
    expect(result.unclassified).toEqual([]);
    expect(result.delegate.map((e) => e.id)).toEqual(["u.md"]);
    expect(result.delegate[0]).toMatchObject({ urgent: true, important: false });
  });

  it("applyPendingMoves — 保留移動は決して未分類を目的象限にしない（AC4・両軸明示）", () => {
    // given: 全象限へ移す保留（両軸は常に明示 boolean）
    const base = placements({ do: [entry("a.md", "a", true, true)] });
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: false, important: false }],
    ]);
    // when
    const result = applyPendingMoves(base, pending);
    // then: 未分類には入らず Delete に入る
    expect(result.unclassified).toEqual([]);
    expect(result.delete.map((e) => e.id)).toEqual(["a.md"]);
  });

  it("applyPendingMoves — 元の placements を破壊しない（純粋性）", () => {
    // given
    const base = placements({ schedule: [entry("a.md", "a", false, true)] });
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
    ]);
    // when
    applyPendingMoves(base, pending);
    // then: 入力はそのまま
    expect(base.schedule.map((e) => e.id)).toEqual(["a.md"]);
    expect(base.do).toEqual([]);
  });

  it("applyPendingMoves — entries に存在しない保留 id は無視する（防御）", () => {
    // given
    const base = placements({ do: [entry("a.md", "a", true, true)] });
    const pending: PendingMoves = new Map([
      ["ghost.md", { urgent: false, important: false }],
    ]);
    // when
    const result = applyPendingMoves(base, pending);
    // then: 既存配置は変わらず ghost は現れない
    expect(result.do.map((e) => e.id)).toEqual(["a.md"]);
    expect(result.delete).toEqual([]);
  });
});

describe("reconcilePendingMoves — 確定/保留の判定（AC2）", () => {
  it("reconcilePendingMoves — サーバ値が保留と一致したら保留から落とす（確定）", () => {
    // given: a を do(true,true) へ移し、サーバ値もそうなった
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
    ]);
    const entries = [entry("a.md", "a", true, true)];
    // when
    const result = reconcilePendingMoves(pending, entries);
    // then
    expect(result.has("a.md")).toBe(false);
    expect(result.size).toBe(0);
  });

  it("reconcilePendingMoves — サーバ値がまだ一致しない保留は残す", () => {
    // given: 保留は do(true,true) だがサーバはまだ schedule(false,true)
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
    ]);
    const entries = [entry("a.md", "a", false, true)];
    // when
    const result = reconcilePendingMoves(pending, entries);
    // then
    expect(result.has("a.md")).toBe(true);
    expect(result.get("a.md")).toEqual({ urgent: true, important: true });
  });

  it("reconcilePendingMoves — entries に存在しない（削除された）保留は落とす", () => {
    // given
    const pending: PendingMoves = new Map([
      ["gone.md", { urgent: true, important: true }],
    ]);
    const entries = [entry("a.md", "a", true, true)];
    // when
    const result = reconcilePendingMoves(pending, entries);
    // then
    expect(result.has("gone.md")).toBe(false);
  });

  it("reconcilePendingMoves — 入力の Map を破壊しない（純粋性）", () => {
    // given
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
    ]);
    const entries = [entry("a.md", "a", true, true)];
    // when
    reconcilePendingMoves(pending, entries);
    // then
    expect(pending.has("a.md")).toBe(true);
  });
});

describe("ロールバック意味論（AC3）", () => {
  it("rollback — 失敗した保留を取り除くと placements がサーバ状態（元象限）へ戻る", () => {
    // given: schedule のカードを do へ楽観移動した状態
    const serverPlacements = placements({
      schedule: [entry("a.md", "a", false, true)],
    });
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
    ]);
    const optimistic = applyPendingMoves(serverPlacements, pending);
    expect(optimistic.do.map((e) => e.id)).toEqual(["a.md"]);
    // when: 書き込み失敗 → 当該保留を破棄して再適用
    pending.delete("a.md");
    const rolledBack = applyPendingMoves(serverPlacements, pending);
    // then: 元の Schedule に戻る
    expect(rolledBack.do).toEqual([]);
    expect(rolledBack.schedule.map((e) => e.id)).toEqual(["a.md"]);
  });
});
