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
    // then: #30 でカードは <li>（listitem）を保ち、ドラッグ可能要素（role=button・AC5）は
    // 内側の要素に移した（<ul> のリスト件数/項目位置の SR 読み上げを守る＝回帰ガード）。
    expect(screen.getByText("タスクA")).toBeTruthy();
    expect(screen.getByText("タスクB")).toBeTruthy();
    expect(container.querySelectorAll(".eisenhower-note-card")).toHaveLength(2);
    // <li> が listitem を保つ（dnd の role=button を <li> へ戻す回帰を検知する）。
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // ドラッグ可能要素は内側にあり role=button を持つ（listitem の上書きではない）。
    expect(screen.getAllByRole("button")).toHaveLength(2);
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

  it("QuadrantCell — 件数バッジは role=img＋aria-label で AT に件数を露出する（role なし span は読まれない懸念の是正）", () => {
    // given / when: 既定 itemCountLabel（"N 件"）
    render(
      <QuadrantCell
        quadrant="do"
        label="Do"
        axisLabel="重要 × 緊急"
        entries={[entry("a.md", "a"), entry("b.md", "b")]}
      />,
    );
    // then: role=img のアクセシブル名として件数ラベルが取得できる（裸の数字だけが読まれる状態を避ける）
    expect(screen.getByRole("img", { name: "2 件" })).toBeTruthy();
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

describe("QuadrantCell — 象限アクセント色（#23 F6・AC2）", () => {
  it("QuadrantCell — accentColor（非空）をセルにインライン CSS 変数で付与する", () => {
    // given / when
    const { container } = render(
      <QuadrantCell
        quadrant="do"
        label="Do"
        axisLabel="重要 × 緊急"
        entries={[]}
        accentColor="#123456"
      />,
    );
    // then: セルの style に --eisenhower-quadrant-accent が載る（styles.css がこの変数を参照）
    const cell = container.querySelector(".eisenhower-quadrant") as HTMLElement;
    expect(cell.style.getPropertyValue("--eisenhower-quadrant-accent")).toBe("#123456");
  });

  it("QuadrantCell — accentColor 未指定/空ならインライン変数を付けない（テーマ既定にフォールバック）", () => {
    // given / when: accentColor を渡さない
    const { container } = render(
      <QuadrantCell quadrant="do" label="Do" axisLabel="重要 × 緊急" entries={[]} />,
    );
    // then: インライン変数は無し（CSS の var(..., --interactive-accent) 側にフォールバック）
    const cell = container.querySelector(".eisenhower-quadrant") as HTMLElement;
    expect(cell.style.getPropertyValue("--eisenhower-quadrant-accent")).toBe("");
  });

  it("QuadrantCell — accentColor 空文字は付与しない", () => {
    const { container } = render(
      <QuadrantCell
        quadrant="do"
        label="Do"
        axisLabel="重要 × 緊急"
        entries={[]}
        accentColor=""
      />,
    );
    const cell = container.querySelector(".eisenhower-quadrant") as HTMLElement;
    expect(cell.style.getPropertyValue("--eisenhower-quadrant-accent")).toBe("");
  });
});
