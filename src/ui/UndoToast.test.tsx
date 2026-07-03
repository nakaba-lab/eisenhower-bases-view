import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { UndoToast } from "./UndoToast";

// vitest は globals 無効のため testing-library の自動 cleanup が走らない（NoteCard.test と同様）。
afterEach(cleanup);

/**
 * UndoToast — 移動成功直後にビュー内へ出す「元に戻す」トースト（undo・draft）。
 *
 * Bases・obsidian 非依存の分離コンポーネント（NoteCard/QuadrantCell と同じ流儀）。
 * 表示・ボタン click の配線・a11y をここで固定し、実際の frontmatter 復元はアダプタ（onUndo 委譲先）が担う。
 */

function props(overrides: Partial<Parameters<typeof UndoToast>[0]> = {}) {
  return {
    message: "「タスクA」を Do へ移動しました",
    regionLabel: "移動の取り消し",
    undoLabel: "元に戻す",
    dismissLabel: "閉じる",
    onUndo: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

describe("UndoToast — 表示と配線（undo・draft）", () => {
  it("UndoToast_message を非ライブの識別領域（role=group + aria-label）に表示する", () => {
    // given / when
    render(<UndoToast {...props()} />);
    // then: role=status（暗黙 aria-live）にはせず、読み上げは sr-status に一本化する（二重読み上げ回避）
    expect(screen.queryByRole("status")).toBeNull();
    const region = screen.getByRole("group", { name: "移動の取り消し" });
    expect(region.textContent).toContain("「タスクA」を Do へ移動しました");
  });

  it("UndoToast_「元に戻す」ボタン click で onUndo を呼ぶ", () => {
    // given
    const onUndo = vi.fn();
    render(<UndoToast {...props({ onUndo })} />);
    // when: アクセシブル名（undoLabel）でボタンを引く
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    // then
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("UndoToast_「閉じる」ボタン click で onDismiss を呼ぶ（onUndo は呼ばない）", () => {
    // given
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(<UndoToast {...props({ onUndo, onDismiss })} />);
    // when
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    // then
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("UndoToast_ボタンは本物の button（キーボード操作可）", () => {
    // given / when
    render(<UndoToast {...props()} />);
    // then: undo/dismiss とも <button>（フォーカス・Enter/Space 起動可能＝a11y 下限）
    const undo = screen.getByRole("button", { name: "元に戻す" });
    const dismiss = screen.getByRole("button", { name: "閉じる" });
    expect(undo.tagName).toBe("BUTTON");
    expect(dismiss.tagName).toBe("BUTTON");
  });
});
