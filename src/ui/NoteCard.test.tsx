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

describe("NoteCard — 非 boolean 軸カードのロック（ドラッグ不可・データ破壊防止）", () => {
  function lockedEntry(): MatrixEntry {
    // 非 boolean 軸値のため未分類に落ち、locked が付いたカード（toViewModel が付与）。
    return { id: "num.md", title: "数値タスク", urgent: undefined, important: undefined, locked: true };
  }

  it("NoteCard_通常カードはドラッグ可能（aria-roledescription=draggable を持つ・対照）", () => {
    // given / when: locked でない通常カードは dnd-kit の draggable 属性を持つ
    render(<NoteCard entry={entry()} />);
    // then
    expect(
      screen.getByRole("button").getAttribute("aria-roledescription"),
    ).toBe("draggable");
  });

  it("NoteCard_ロックカードはドラッグ不可（draggable 属性を付けず --locked クラスを持つ）", () => {
    // given / when
    render(<NoteCard entry={lockedEntry()} />);
    const el = screen.getByRole("button");
    // then: dnd-kit の draggable 属性を付けない（掴めない）＋視覚マークのクラス
    expect(el.getAttribute("aria-roledescription")).toBeNull();
    expect(el.classList.contains("eisenhower-note-card--locked")).toBe(true);
  });

  it("NoteCard_ロックカードもクリックで開ける（値を直せるよう開く導線は残す）", () => {
    // given
    const onOpenCard = vi.fn();
    render(<NoteCard entry={lockedEntry()} onOpenCard={onOpenCard} />);
    // when
    fireEvent.click(screen.getByRole("button"));
    // then
    expect(onOpenCard).toHaveBeenCalledWith("num.md", { newLeaf: false });
  });

  it("NoteCard_ロックカードは Enter で開く（button の標準操作）", () => {
    // given
    const onOpenCard = vi.fn();
    render(<NoteCard entry={lockedEntry()} onOpenCard={onOpenCard} />);
    // when
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    // then
    expect(onOpenCard).toHaveBeenCalledWith("num.md", { newLeaf: false });
  });

  it("NoteCard_ロックカードは Space でも開き、既定動作を抑止する（掴めないため Space を開くに割当・スクロール防止・レビュー指摘）", () => {
    // given: ロックカードは掴めない（Space の掴み予約が無い）ので Space も「開く」に使う
    const onOpenCard = vi.fn();
    render(<NoteCard entry={lockedEntry()} onOpenCard={onOpenCard} />);
    // when: Space 押下（preventDefault を検知するため cancelable なイベントで）
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    screen.getByRole("button").dispatchEvent(event);
    // then: 開く導線が発火し、ペインのスクロール（既定動作）は抑止される
    expect(onOpenCard).toHaveBeenCalledWith("num.md", { newLeaf: false });
    expect(event.defaultPrevented).toBe(true);
  });

  it("NoteCard_ロックカードは lockedLabel でアクセシブル名に移動不可の理由を含める", () => {
    // given / when
    render(
      <NoteCard entry={lockedEntry()} lockedLabel={(title) => `${title}（移動不可）`} />,
    );
    // then: SR には「移動できない理由」が伝わる
    expect(screen.getByRole("button", { name: "数値タスク（移動不可）" })).toBeTruthy();
  });
});

describe("NoteCard — 滞留バッジ（mtime ヒューリスティック・#106 AC4）", () => {
  /** 滞留フラグ付きカード（toViewModel が stagnant/stagnantDays を付与）。 */
  function stagnantEntry(days = 21): MatrixEntry {
    return { id: "old.md", title: "古いタスク", urgent: true, important: true, stagnant: true, stagnantDays: days };
  }
  const badge = (days: number) => `${days}d`;
  const label = (days: number) => `Stale: not updated for ${days} days`;

  it("NoteCard_滞留カード_時計と経過日数バッジを表示する（AC4）", () => {
    // given / when
    render(<NoteCard entry={stagnantEntry(21)} stagnantBadge={badge} stagnantLabel={label} />);
    // then: 経過日数のテキストがカード内に出る
    expect(screen.getByText("21d")).toBeTruthy();
  });

  it("NoteCard_滞留バッジ_経過日数を aria-label で読み上げる（時計は装飾＝aria-hidden）", () => {
    // given / when
    render(<NoteCard entry={stagnantEntry(21)} stagnantBadge={badge} stagnantLabel={label} />);
    // then: SR には経過日数付きの滞留ラベルが伝わる（img ロール＋aria-label）
    expect(
      screen.getByRole("img", { name: "Stale: not updated for 21 days" }),
    ).toBeTruthy();
  });

  it("NoteCard_滞留バッジ_--text-muted のクラスで控えめに描画する", () => {
    // given / when
    render(<NoteCard entry={stagnantEntry(21)} stagnantBadge={badge} stagnantLabel={label} />);
    // then: 専用クラスを持つ（styles.css が --text-muted を当てる）
    const el = screen.getByText("21d");
    expect(el.classList.contains("eisenhower-note-card__stagnation")).toBe(true);
  });

  it("NoteCard_非滞留カード_滞留バッジを出さない", () => {
    // given: stagnant を持たない通常カード
    render(<NoteCard entry={entry()} stagnantBadge={badge} stagnantLabel={label} />);
    // then: バッジは描画されない
    expect(screen.queryByText(/\d+d/)).toBeNull();
  });
});
