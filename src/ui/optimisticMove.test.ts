import { describe, expect, it } from "vitest";
import type { MatrixEntry, QuadrantPlacements } from "../bases/types";
import {
  applyPendingMoves,
  dropPending,
  isLatestGeneration,
  reconcilePendingMoves,
  rollbackFailedMove,
  settleAnnouncement,
  shouldSkipMove,
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

  it("reconcilePendingMoves — in-flight 中はサーバ値が偶然一致しても保留を残す（coincidental match 防止・レビュー指摘）", () => {
    // given: サーバ値が保留値とたまたま一致するが、当該 entry の書き込みはまだ in-flight
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
    ]);
    const entries = [entry("a.md", "a", true, true)];
    // when
    const result = reconcilePendingMoves(pending, entries, new Set(["a.md"]));
    // then: 早期確定せず残す（古いスナップショットで最新保留を落とさない）
    expect(result.has("a.md")).toBe(true);
  });

  it("reconcilePendingMoves — in-flight が無ければ値一致した保留を確定して落とす", () => {
    // given
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
    ]);
    const entries = [entry("a.md", "a", true, true)];
    // when: in-flight 集合が空
    const result = reconcilePendingMoves(pending, entries, new Set());
    // then
    expect(result.has("a.md")).toBe(false);
  });
});

describe("dropPending — undo 時に楽観オーバーレイを落とす（レビュー指摘: undo 後の貼り付き修正）", () => {
  it("dropPending — 指定 entry の保留を落とした新しい Map を返し、入力を破壊しない", () => {
    // given: a と b の保留がある
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true }],
      ["b.md", { urgent: false, important: false }],
    ]);
    // when: a を undo（保留を落とす）
    const result = dropPending(pending, "a.md");
    // then: a は消え b は残る・入力 Map は不変（純粋性）
    expect(result.has("a.md")).toBe(false);
    expect(result.has("b.md")).toBe(true);
    expect(pending.has("a.md")).toBe(true);
  });

  it("dropPending — undo 後に applyPendingMoves がサーバ値の象限へ戻る（貼り付き解消）", () => {
    // given: schedule のカードを do へ楽観移動した状態（pending 残存）
    const serverPlacements = placements({ schedule: [entry("a.md", "a", false, true)] });
    const pending: PendingMoves = new Map([["a.md", { urgent: true, important: true }]]);
    expect(applyPendingMoves(serverPlacements, pending).do.map((e) => e.id)).toEqual(["a.md"]);
    // when: undo で保留を落とす
    const after = dropPending(pending, "a.md");
    // then: オーバーレイが消え、サーバ値（schedule）の位置に戻る（do に貼り付かない）
    const rendered = applyPendingMoves(serverPlacements, after);
    expect(rendered.do).toEqual([]);
    expect(rendered.schedule.map((e) => e.id)).toEqual(["a.md"]);
  });

  it("dropPending — 該当保留が無ければ同じ Map 参照を返す（不要な再描画を避ける）", () => {
    // given
    const pending: PendingMoves = new Map([["a.md", { urgent: true, important: true }]]);
    // when / then: 未登録 id は同一参照
    expect(dropPending(pending, "ghost.md")).toBe(pending);
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

describe("isLatestGeneration / rollbackFailedMove — 世代ベースのロールバック判定（レビュー指摘）", () => {
  it("isLatestGeneration — 保留の世代が一致すれば true・上書き/不在なら false", () => {
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true, generation: 2 }],
    ]);
    expect(isLatestGeneration(pending, "a.md", 2)).toBe(true);
    expect(isLatestGeneration(pending, "a.md", 1)).toBe(false); // 旧世代（上書き済み）
    expect(isLatestGeneration(pending, "ghost.md", 2)).toBe(false); // 不在
  });

  it("rollbackFailedMove — 最新世代の失敗は保留を取り除き rolledBack=true", () => {
    // given
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: true, important: true, generation: 3 }],
    ]);
    // when: gen3 の書き込みが失敗
    const result = rollbackFailedMove(pending, "a.md", 3);
    // then
    expect(result.rolledBack).toBe(true);
    expect(result.pending.has("a.md")).toBe(false);
    expect(pending.has("a.md")).toBe(true); // 入力を破壊しない（純粋性）
  });

  it("rollbackFailedMove — 旧世代の失敗は巻き戻さず rolledBack=false（後続の新しい移動を守る）", () => {
    // given: 連続ドラッグで保留は最新 gen2 になっている
    const pending: PendingMoves = new Map([
      ["a.md", { urgent: false, important: false, generation: 2 }],
    ]);
    // when: 古い gen1 の書き込みが遅れて失敗
    const result = rollbackFailedMove(pending, "a.md", 1);
    // then: 最新 gen2 の楽観状態を残す（巻き戻さない）＝同じ Map をそのまま返す
    expect(result.rolledBack).toBe(false);
    expect(result.pending).toBe(pending);
    expect(result.pending.get("a.md")).toEqual({
      urgent: false,
      important: false,
      generation: 2,
    });
  });
});

describe("settleAnnouncement — settle 結果から SR 通知種別を決める（レビュー指摘の回帰ガード）", () => {
  it("settleAnnouncement — 最新世代の失敗は failure（実際にロールバックしたときだけ失敗通知）", () => {
    expect(settleAnnouncement(true, true)).toBe("failure");
  });

  it("settleAnnouncement — 古い世代の失敗は silent（巻き戻していないのに『元に戻しました』と誤報しない）", () => {
    expect(settleAnnouncement(true, false)).toBe("silent");
  });

  it("settleAnnouncement — 最新世代の成功は success", () => {
    expect(settleAnnouncement(false, true)).toBe("success");
  });

  it("settleAnnouncement — superseded な成功は silent（古い書き込みの成功で象限を読み上げない）", () => {
    expect(settleAnnouncement(false, false)).toBe("silent");
  });
});

describe("shouldSkipMove — 同一象限への無駄打ちを弾く純関数（#9 の no-op ガード）", () => {
  it("shouldSkipMove — 現在値と目的値が両軸一致なら true（書き戻さない）", () => {
    // given / when / then: Do（true/true）にいるカードを Do へ落とす
    expect(
      shouldSkipMove({ urgent: true, important: true }, { urgent: true, important: true }),
    ).toBe(true);
  });

  it("shouldSkipMove — どちらかの軸が異なれば false（別象限への実移動）", () => {
    // given: Schedule（false/true）→ Do（true/true）
    expect(
      shouldSkipMove({ urgent: false, important: true }, { urgent: true, important: true }),
    ).toBe(false);
  });

  it("shouldSkipMove — 未分類（軸 absent=undefined）からの移動は false（必ず実移動扱い）", () => {
    // given: 両軸 absent のカードを Delete（false/false）へ。undefined !== false でスキップされない
    expect(
      shouldSkipMove(
        { urgent: undefined, important: undefined },
        { urgent: false, important: false },
      ),
    ).toBe(false);
  });

  it("shouldSkipMove — current 未知（保留にも entries にも無い）なら false（握りつぶさない）", () => {
    // given / when / then
    expect(shouldSkipMove(undefined, { urgent: true, important: false })).toBe(false);
  });
});
