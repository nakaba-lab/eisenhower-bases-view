import { afterEach, describe, expect, it } from "vitest";
import type { MatrixViewModel } from "../bases/types";
import { render, unmount } from "./MatrixView";

/**
 * MatrixView — アダプタ層が onDataUpdated 内で呼ぶ命令的な描画入口（AC3）。
 * F1 範囲はシェル＋状態表示（loading / empty / ready）。4 象限の実配置は #19。
 * unmount でコンテナを空にしリークを防ぐ（AC4）。
 */

function mountContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MatrixView render", () => {
  it("render — loading 状態でローディング表示（role=status）を描画する", () => {
    // given
    const container = mountContainer();
    const viewModel: MatrixViewModel = { state: "loading", entries: [] };
    // when
    render(container, viewModel, {});
    // then
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(container.textContent).toContain("読み込み中");
  });

  it("render — empty 状態で空プレースホルダを描画する", () => {
    // given
    const container = mountContainer();
    const viewModel: MatrixViewModel = { state: "empty", entries: [] };
    // when
    render(container, viewModel, {});
    // then
    expect(container.textContent).toContain("表示するノートがありません");
  });

  it("render — ready 状態でマトリクス領域（aria-label 付きランドマーク）を描画する", () => {
    // given
    const container = mountContainer();
    const viewModel: MatrixViewModel = {
      state: "ready",
      entries: [{ id: "a.md", title: "a" }],
    };
    // when
    render(container, viewModel, {});
    // then
    const region = container.querySelector('[aria-label="Eisenhower Matrix"]');
    expect(region).not.toBeNull();
  });

  it("unmount — 描画後に unmount するとコンテナが空になる（リーク防止 AC4）", () => {
    // given
    const container = mountContainer();
    render(container, { state: "ready", entries: [] }, {});
    expect(container.childElementCount).toBeGreaterThan(0);
    // when
    unmount(container);
    // then
    expect(container.childElementCount).toBe(0);
  });
});
