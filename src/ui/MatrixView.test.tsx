import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatrixEntry, MatrixViewModel, QuadrantPlacements } from "../bases/types";
import { render, unmount } from "./MatrixView";

/**
 * MatrixView — アダプタ層が onDataUpdated 内で呼ぶ命令的な描画入口（AC3）。
 * F1（#18）はシェル＋状態表示。#19（F2）で 2×2 グリッド（Do/Schedule/Delegate/Delete）
 * ＋下部フル幅の未分類ゾーンに、placements のカードを配置する。
 */

function mountContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

function entry(id: string, title: string): MatrixEntry {
  return { id, title, urgent: undefined, important: undefined };
}

function emptyPlacements(): QuadrantPlacements {
  return { do: [], schedule: [], delegate: [], delete: [], unclassified: [] };
}

function readyViewModel(placements: Partial<QuadrantPlacements>): MatrixViewModel {
  const merged = { ...emptyPlacements(), ...placements };
  const entries = Object.values(merged).flat();
  return { state: "ready", entries, placements: merged };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MatrixView render — 状態表示", () => {
  it("render — loading 状態でローディング表示（role=status）を描画する", () => {
    const container = mountContainer();
    render(container, { state: "loading", entries: [], placements: emptyPlacements() }, {});
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("読み込み中");
  });

  it("render — empty 状態で空プレースホルダを描画する", () => {
    const container = mountContainer();
    render(container, { state: "empty", entries: [], placements: emptyPlacements() }, {});
    expect(container.textContent).toContain("表示するノートがありません");
  });

  it("render — ready 状態でマトリクス領域（aria-label 付きランドマーク）を描画する", () => {
    const container = mountContainer();
    render(container, readyViewModel({ do: [entry("a.md", "a")] }), {});
    expect(container.querySelector('[aria-label="Eisenhower Matrix"]')).not.toBeNull();
  });
});

describe("MatrixView render — 2×2 グリッド配置（#19）", () => {
  it("render — ready で 4 象限セル＋未分類ゾーンを描画する", () => {
    // given
    const container = mountContainer();
    // when
    render(container, readyViewModel({}), {});
    // then: Do/Schedule/Delegate/Delete/未分類 の 5 領域（aria-label は「象限名（軸ラベル）」前方一致）
    for (const label of ["Do", "Schedule", "Delegate", "Delete", "未分類"]) {
      expect(container.querySelector(`[aria-label^="${label}"]`)).not.toBeNull();
    }
  });

  it("render — カードを対応する象限セル内に配置する（誤配置しない）", () => {
    // given
    const container = mountContainer();
    const vm = readyViewModel({
      do: [entry("do.md", "緊急重要タスク")],
      unclassified: [entry("x.md", "軸欠損ノート")],
    });
    // when
    render(container, vm, {});
    // then: Do セル内に do カード、未分類セル内に欠損ノート
    const doCell = container.querySelector('[aria-label^="Do"]');
    const uncCell = container.querySelector('[aria-label^="未分類"]');
    expect(doCell?.textContent).toContain("緊急重要タスク");
    expect(uncCell?.textContent).toContain("軸欠損ノート");
    // 未分類のカードが Do に漏れていない
    expect(doCell?.textContent).not.toContain("軸欠損ノート");
  });

  it("render — 0 件の象限は空プレースホルダ（なし）を表示する", () => {
    // given
    const container = mountContainer();
    // when: Do に 1 件、他は 0 件
    render(container, readyViewModel({ do: [entry("do.md", "t")] }), {});
    // then: Schedule セル内に空プレースホルダ
    const schedule = container.querySelector('[aria-label^="Schedule"]');
    expect(schedule?.textContent).toContain("なし");
  });
});

describe("MatrixView render — 未分類ゾーンの表示制御 / a11y（レビュー指摘）", () => {
  it("render — showUnclassified=false で未分類ゾーンを描画しない（4 象限は残す）", () => {
    // given: 未分類カードを持つが showUnclassified=false
    const container = mountContainer();
    const vm: MatrixViewModel = {
      ...readyViewModel({ unclassified: [entry("x.md", "軸欠損ノート")] }),
      showUnclassified: false,
    };
    // when
    render(container, vm, {});
    // then: 未分類ゾーンは出ない（4 象限は残る）
    expect(container.querySelector('[aria-label^="未分類"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Do"]')).not.toBeNull();
    expect(container.textContent).not.toContain("軸欠損ノート");
  });

  it("render — showUnclassified 省略時は従来どおり未分類ゾーンを描画する（後方互換）", () => {
    const container = mountContainer();
    render(container, readyViewModel({}), {});
    expect(container.querySelector('[aria-label^="未分類"]')).not.toBeNull();
  });

  it("render — 移動結果通知用の aria-live ステータス領域を持つ（SR 向け）", () => {
    // given / when
    const container = mountContainer();
    render(container, readyViewModel({ do: [entry("a.md", "a")] }), {});
    // then: ready マトリクス内に role=status・aria-live のライブ領域がある
    const status = container.querySelector(".eisenhower-matrix__sr-status");
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("MatrixView — カードを開く導線の配線（#22 F5）", () => {
  it("render — カードのクリックで callbacks.onOpenCard(entryId, {newLeaf:false}) を呼ぶ", () => {
    // given: onOpenCard を持つ callbacks で ready 描画（MatrixView→QuadrantCell→NoteCard の配線検証）
    const container = mountContainer();
    const onOpenCard = vi.fn();
    render(container, readyViewModel({ do: [entry("do.md", "タスク")] }), { onOpenCard });
    // when: 素のクリック（距離活性化制約によりドラッグにならずクリックとして成立）
    const card = container.querySelector('[role="button"]') as HTMLElement;
    card.click();
    // then
    expect(onOpenCard).toHaveBeenCalledWith("do.md", { newLeaf: false });
  });

  it("render — カードのホバーで callbacks.onHoverCard(entryId, 要素) を呼ぶ", () => {
    // given
    const container = mountContainer();
    const onHoverCard = vi.fn();
    render(container, readyViewModel({ do: [entry("do.md", "タスク")] }), { onHoverCard });
    // when
    const card = container.querySelector('[role="button"]') as HTMLElement;
    card.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    // then
    expect(onHoverCard).toHaveBeenCalledTimes(1);
    expect(onHoverCard.mock.calls[0][0]).toBe("do.md");
  });
});

describe("MatrixView unmount", () => {
  it("unmount — 描画後に unmount するとコンテナが空になる（リーク防止 AC4）", () => {
    const container = mountContainer();
    render(container, readyViewModel({}), {});
    expect(container.childElementCount).toBeGreaterThan(0);
    unmount(container);
    expect(container.childElementCount).toBe(0);
  });
});
