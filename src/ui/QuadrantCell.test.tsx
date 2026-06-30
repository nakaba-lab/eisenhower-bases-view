import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import type { MatrixEntry } from "../bases/types";
import { QuadrantCell } from "./QuadrantCell";

// vitest は globals 無効のため testing-library の自動 cleanup が走らない。
// 各テストで DOM を破棄してテスト間の漏れ（listitem の累積）を防ぐ。
afterEach(cleanup);

/**
 * QuadrantCell — 1 象限（または未分類ゾーン）のセル。
 * #19（F2）で軸ラベル・カード一覧・件数・象限別空プレースホルダを描画する。
 */

function entry(id: string, title: string): MatrixEntry {
  return { id, title, urgent: undefined, important: undefined };
}

describe("QuadrantCell", () => {
  it("QuadrantCell — 象限ラベル（見出し）と軸ラベルを描画する", () => {
    // given / when
    render(
      <QuadrantCell
        quadrant="do"
        label="Do"
        axisLabel="重要 × 緊急"
        entries={[entry("a.md", "a")]}
      />,
    );
    // then
    expect(screen.getByRole("heading", { name: "Do" }).textContent).toBe("Do");
    expect(screen.getByText("重要 × 緊急")).toBeTruthy();
  });

  it("QuadrantCell — カード一覧を件数ぶん描画する", () => {
    // given / when
    const { container } = render(
      <QuadrantCell
        quadrant="schedule"
        label="Schedule"
        axisLabel="重要 × 非緊急"
        entries={[entry("a.md", "タスクA"), entry("b.md", "タスクB")]}
      />,
    );
    // then: #20 でカードは dnd-kit draggable（role=button・キーボード操作可＝AC5）になり
    // listitem ロールは持たないため、カード要素そのものを件数で数える。
    expect(screen.getByText("タスクA")).toBeTruthy();
    expect(screen.getByText("タスクB")).toBeTruthy();
    expect(container.querySelectorAll(".eisenhower-note-card")).toHaveLength(2);
  });

  it("QuadrantCell — 0 件なら空プレースホルダを描画する", () => {
    // given / when
    render(
      <QuadrantCell
        quadrant="delete"
        label="Delete"
        axisLabel="非重要 × 非緊急"
        entries={[]}
      />,
    );
    // then
    expect(screen.getByText("なし")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("QuadrantCell — 象限名＋軸ラベルが aria-label として領域（region）に付く", () => {
    // given / when
    render(
      <QuadrantCell
        quadrant="unclassified"
        label="未分類"
        axisLabel="軸欠損・ドロップ不可"
        entries={[]}
        variant="unclassified"
      />,
    );
    // then: ランドマーク名に軸の文脈（軸ラベル）が含まれる（a11y）
    expect(screen.getByRole("region", { name: "未分類（軸欠損・ドロップ不可）" })).toBeTruthy();
  });
});
