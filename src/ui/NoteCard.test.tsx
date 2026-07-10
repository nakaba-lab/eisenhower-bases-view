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

describe("NoteCard — カード追加プロパティ表示（バッジ・#104 F8 AC5）", () => {
  /** バッジ付き entry。 */
  function badgedEntry(
    badges: MatrixEntry["badges"],
    id = "a.md",
    title = "タスクA",
  ): MatrixEntry {
    return { id, title, urgent: undefined, important: undefined, badges };
  }

  it("NoteCard_バッジをタイトル下に控えめに表示する（label と value を描画・AC5）", () => {
    // given: 期日・プロジェクトの 2 バッジ
    const entry = badgedEntry([
      { label: "due", text: "2026-07-01" },
      { label: "project", text: "仕事" },
    ]);
    // when
    const { container } = render(<NoteCard entry={entry} />);
    // then: タイトルとバッジのラベル・値が描画される
    expect(screen.getByText("タスクA")).toBeTruthy();
    expect(screen.getByText("2026-07-01")).toBeTruthy();
    expect(screen.getByText("仕事")).toBeTruthy();
    const badges = container.querySelectorAll(".eisenhower-note-card__badge");
    expect(badges).toHaveLength(2);
  });

  it("NoteCard_バッジのラベルと値を両方描画する（SR はラベル+値を読み上げ・人間承認）", () => {
    // given
    const entry = badgedEntry([{ label: "due", text: "2026-07-01" }]);
    // when
    render(<NoteCard entry={entry} />);
    // then: アクセシブル名はノート名を保ちつつ、ラベル・値の両方が可視テキストとして読み上げ対象に含まれる
    expect(screen.getByText("due")).toBeTruthy();
    expect(screen.getByText("2026-07-01")).toBeTruthy();
  });

  it("NoteCard_emphasized バッジは強調クラスを持つ（アクセント色・AC4）", () => {
    // given: 過去日で強調フラグ付き
    const entry = badgedEntry([{ label: "due", text: "2026-07-01", emphasized: true }]);
    // when
    const { container } = render(<NoteCard entry={entry} />);
    // then: 強調バッジに --emphasized 修飾クラスが付く（styles.css がアクセント色を当てる）
    const emphasized = container.querySelector(".eisenhower-note-card__badge--emphasized");
    expect(emphasized).toBeTruthy();
    expect(emphasized?.textContent).toContain("2026-07-01");
  });

  it("NoteCard_emphasized でないバッジは強調クラスを持たない（既定オフ）", () => {
    const entry = badgedEntry([{ label: "due", text: "2026-07-10" }]);
    const { container } = render(<NoteCard entry={entry} />);
    expect(container.querySelector(".eisenhower-note-card__badge--emphasized")).toBeNull();
  });

  it("NoteCard_バッジが無ければバッジ領域を描画しない（表示 0 個は現状維持・AC3）", () => {
    // given: badges undefined（既定）
    const { container } = render(<NoteCard entry={badgedEntry(undefined)} />);
    // then: バッジコンテナ自体が無い＝タイトルのみのカード密度
    expect(container.querySelector(".eisenhower-note-card__badges")).toBeNull();
    expect(screen.getByText("タスクA")).toBeTruthy();
  });

  it("NoteCard_空配列のバッジも領域を描画しない", () => {
    const { container } = render(<NoteCard entry={badgedEntry([])} />);
    expect(container.querySelector(".eisenhower-note-card__badges")).toBeNull();
  });
});
