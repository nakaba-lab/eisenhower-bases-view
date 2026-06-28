import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/preact";
import { QuadrantCell } from "./QuadrantCell";

describe("QuadrantCell", () => {
  it("QuadrantCell — ラベルと件数を描画する", () => {
    // given / when
    render(<QuadrantCell label="Do" count={3} />);
    // then
    expect(screen.getByRole("heading", { name: "Do" }).textContent).toBe("Do");
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("QuadrantCell — ラベルが aria-label として領域に付く", () => {
    // given / when
    render(<QuadrantCell label="未分類" count={0} />);
    // then
    expect(screen.getByRole("region", { name: "未分類" })).toBeTruthy();
  });
});
