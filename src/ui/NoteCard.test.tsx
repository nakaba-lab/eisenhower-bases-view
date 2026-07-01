import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { MatrixEntry } from "../bases/types";
import { NoteCard } from "./NoteCard";

// vitest は globals 無効のため testing-library の自動 cleanup が走らない（QuadrantCell.test と同様）。
afterEach(cleanup);

/**
 * NoteCard — 1 ノートのカード。#20（F3）でドラッグ可能、#22（F5）で「開く／プレビュー」導線を足す。
 *
 * 開く（クリック/Enter/Mod+）とプレビュー（ホバー）は `MatrixCallbacks`（onOpenCard/onHoverCard）
 * へ委譲し、UI は obsidian 型に触れない（AC5）。ここではカードが正しい引数でコールバックを呼ぶことを検証する
 *（TFile 解決・workspace 操作・hover-link 発火・dnd-kit 実ドラッグは手動/結合で担保）。
 */

function entry(id = "a.md", title = "タスクA"): MatrixEntry {
  return { id, title, urgent: undefined, important: undefined };
}

describe("NoteCard — カードを開く導線（#22 F5 AC1/AC2/AC4）", () => {
  it("NoteCard_素のクリック_現在のリーフで開く（onOpenCard newLeaf=false）", () => {
    // given
    const onOpenCard = vi.fn();
    render(<NoteCard entry={entry()} onOpenCard={onOpenCard} />);
    // when
    fireEvent.click(screen.getByRole("button"));
    // then
    expect(onOpenCard).toHaveBeenCalledWith("a.md", { newLeaf: false });
  });

  it("NoteCard_Mod（meta）+クリック_新タブで開く（newLeaf=true・AC2）", () => {
    // given
    const onOpenCard = vi.fn();
    render(<NoteCard entry={entry()} onOpenCard={onOpenCard} />);
    // when
    fireEvent.click(screen.getByRole("button"), { metaKey: true });
    // then
    expect(onOpenCard).toHaveBeenCalledWith("a.md", { newLeaf: true });
  });

  it("NoteCard_Mod（ctrl）+クリック_新タブで開く（newLeaf=true・AC2 win）", () => {
    // given: Windows は Ctrl 修飾。mac の Cmd（metaKey）と同じく新タブへ（AC2 のクロスプラットフォーム）。
    const onOpenCard = vi.fn();
    render(<NoteCard entry={entry()} onOpenCard={onOpenCard} />);
    // when
    fireEvent.click(screen.getByRole("button"), { ctrlKey: true });
    // then
    expect(onOpenCard).toHaveBeenCalledWith("a.md", { newLeaf: true });
  });

  it("NoteCard_Enter_現在のリーフで開く（AC4）", () => {
    // given
    const onOpenCard = vi.fn();
    render(<NoteCard entry={entry()} onOpenCard={onOpenCard} />);
    // when
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    // then
    expect(onOpenCard).toHaveBeenCalledWith("a.md", { newLeaf: false });
  });

  it("NoteCard_Mod（ctrl）+Enter_新タブで開く", () => {
    // given
    const onOpenCard = vi.fn();
    render(<NoteCard entry={entry()} onOpenCard={onOpenCard} />);
    // when
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter", ctrlKey: true });
    // then
    expect(onOpenCard).toHaveBeenCalledWith("a.md", { newLeaf: true });
  });

  it("NoteCard_Space_開かない（掴む＝ドラッグに予約・AC4 の裏）", () => {
    // given
    const onOpenCard = vi.fn();
    render(<NoteCard entry={entry()} onOpenCard={onOpenCard} />);
    // when: Space は KeyboardSensor の掴み（ドラッグ）に予約。開く導線は発火しない。
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    // then
    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it("NoteCard_カードはフォーカス可能（tabIndex=0）_Tab で到達できる（AC4 の下限）", () => {
    // given / when: dnd-kit の attributes が role=button・tabIndex=0 を付与する（フォーカス可視の前提）。
    render(<NoteCard entry={entry()} />);
    // then: 視覚のフォーカスリングは frontend-reviewer で目視。ここでは focusable であることを非視覚で担保。
    expect(screen.getByRole("button").tabIndex).toBe(0);
  });
});

describe("NoteCard — ホバーでページプレビュー（#22 F5 AC3）", () => {
  it("NoteCard_マウスホバー_onHoverCard（entryId, 要素）を呼ぶ", () => {
    // given
    const onHoverCard = vi.fn();
    render(<NoteCard entry={entry()} onHoverCard={onHoverCard} />);
    const el = screen.getByRole("button");
    // when
    fireEvent.mouseEnter(el);
    // then: id と（hover-link 発火の targetEl になる）カード要素を渡す
    expect(onHoverCard).toHaveBeenCalledTimes(1);
    expect(onHoverCard.mock.calls[0][0]).toBe("a.md");
    expect(onHoverCard.mock.calls[0][1]).toBe(el);
  });

  it("NoteCard_native title 属性を持たない（コアプレビューと二重ツールチップにしない）", () => {
    // given / when
    render(<NoteCard entry={entry()} />);
    // then: F5 で native title を撤去し、ホバーはコア page-preview に一本化する
    expect(screen.getByRole("button").getAttribute("title")).toBeNull();
  });
});
