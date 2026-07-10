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

describe("NoteCard — 滞留バッジ（mtime ヒューリスティック・#106 F9 AC4）", () => {
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

describe("NoteCard — カード上の完了トグル（#105 F10 AC1/AC4/AC5）", () => {
  /** 完了ラベル（i18n の状態別 aria-label 相当）。 */
  const completionLabel = (completed: boolean) => (completed ? "未完了に戻す" : "完了にする");

  function completionEntry(over: Partial<MatrixEntry> = {}): MatrixEntry {
    return { id: "a.md", title: "タスクA", urgent: true, important: true, ...over };
  }

  it("NoteCard_完了プロパティ有効時_チェックボタンを描画する（未完了は『完了にする』ラベル）", () => {
    // given / when
    render(
      <NoteCard
        entry={completionEntry()}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={vi.fn()}
      />,
    );
    // then: aria-label 付きのチェックボタンが出る（状態別文言）
    expect(screen.getByRole("button", { name: "完了にする" })).toBeTruthy();
  });

  it("NoteCard_完了プロパティ無効時_チェックボタンを描画しない（opt-in）", () => {
    // given / when: completionEnabled を渡さない
    render(<NoteCard entry={completionEntry()} onToggleCompletion={vi.fn()} />);
    // then
    expect(screen.queryByRole("button", { name: "完了にする" })).toBeNull();
    expect(screen.queryByRole("button", { name: "未完了に戻す" })).toBeNull();
  });

  it("NoteCard_チェックボタンのクリック_onToggleCompletion(id, true) を呼ぶ（未完了→完了・AC1）", () => {
    // given
    const onToggleCompletion = vi.fn();
    render(
      <NoteCard
        entry={completionEntry()}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={onToggleCompletion}
      />,
    );
    // when
    fireEvent.click(screen.getByRole("button", { name: "完了にする" }));
    // then: 目的値 true（done:true 書き込み）を渡す
    expect(onToggleCompletion).toHaveBeenCalledWith("a.md", true);
  });

  it("NoteCard_チェックボタンのクリックは開く導線に伝播しない（stopPropagation・AC5）", () => {
    // given: 開く導線とトグルを両方渡す
    const onOpenCard = vi.fn();
    const onToggleCompletion = vi.fn();
    render(
      <NoteCard
        entry={completionEntry()}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={onToggleCompletion}
        onOpenCard={onOpenCard}
      />,
    );
    // when: チェックボタンをクリック（カード全体の onClick=開く と衝突しうる）
    fireEvent.click(screen.getByRole("button", { name: "完了にする" }));
    // then: トグルは呼ばれ、開く（onOpenCard）は呼ばれない（click-to-open と衝突しない）
    expect(onToggleCompletion).toHaveBeenCalledWith("a.md", true);
    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it("NoteCard_完了カードのチェックボタンは『未完了に戻す』で onToggleCompletion(id, false)（双方向・AC4）", () => {
    // given: 既に完了（done:true）のカード
    const onToggleCompletion = vi.fn();
    render(
      <NoteCard
        entry={completionEntry({ completed: true })}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={onToggleCompletion}
      />,
    );
    // when
    fireEvent.click(screen.getByRole("button", { name: "未完了に戻す" }));
    // then: 目的値 false（done:false を明示書き込み・delete しない）
    expect(onToggleCompletion).toHaveBeenCalledWith("a.md", false);
  });

  it("NoteCard_完了カードは淡色クラス（--completed）を持つ（AC4 淡色表示）", () => {
    // given / when
    const { container } = render(
      <NoteCard
        entry={completionEntry({ completed: true })}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={vi.fn()}
      />,
    );
    // then: 淡色マークのクラス（styles.css が弱色トークンを当てる。opacity ではない）
    expect(container.querySelector(".eisenhower-note-card--completed")).toBeTruthy();
  });

  it("NoteCard_未完了カードは淡色クラスを持たない", () => {
    const { container } = render(
      <NoteCard
        entry={completionEntry({ completed: false })}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={vi.fn()}
      />,
    );
    expect(container.querySelector(".eisenhower-note-card--completed")).toBeNull();
  });

  it("NoteCard_非 boolean 完了値のカード_チェックボタンは無効（disabled）でトグルしない（AC2）", () => {
    // given: completionUnsupported（日付型 done 等）
    const onToggleCompletion = vi.fn();
    render(
      <NoteCard
        entry={completionEntry({ completionUnsupported: true })}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={onToggleCompletion}
      />,
    );
    // when
    const button = screen.getByRole("button", { name: "完了にする" }) as HTMLButtonElement;
    fireEvent.click(button);
    // then: disabled で押しても書き込み経路を塞ぐ（元値を破壊しない）
    expect(button.disabled).toBe(true);
    expect(onToggleCompletion).not.toHaveBeenCalled();
  });

  it("NoteCard_x キー_フォーカス中のカードで完了をトグルする（Space=掴む/Enter=開く と非衝突・AC1）", () => {
    // given
    const onToggleCompletion = vi.fn();
    render(
      <NoteCard
        entry={completionEntry()}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={onToggleCompletion}
      />,
    );
    // when: カード（title のアクセシブル名）に x キー
    fireEvent.keyDown(screen.getByRole("button", { name: "タスクA" }), { key: "x" });
    // then: 完了をトグル（未完了→完了＝true）
    expect(onToggleCompletion).toHaveBeenCalledWith("a.md", true);
  });

  it("NoteCard_x キーは Enter（開く）・Space（掴む）を発火しない（キー衝突なし・AC1）", () => {
    // given
    const onOpenCard = vi.fn();
    const onToggleCompletion = vi.fn();
    render(
      <NoteCard
        entry={completionEntry()}
        completionEnabled
        completionLabel={completionLabel}
        onToggleCompletion={onToggleCompletion}
        onOpenCard={onOpenCard}
      />,
    );
    const card = screen.getByRole("button", { name: "タスクA" });
    // when: x はトグルのみ・Enter は開くのみ
    fireEvent.keyDown(card, { key: "x" });
    fireEvent.keyDown(card, { key: "Enter" });
    // then: x で開かず、Enter でトグルしない（責務が交わらない）
    expect(onToggleCompletion).toHaveBeenCalledTimes(1);
    expect(onOpenCard).toHaveBeenCalledTimes(1);
  });

  it("NoteCard_完了プロパティ無効時_x キーはトグルしない（機能オフ）", () => {
    const onToggleCompletion = vi.fn();
    render(
      <NoteCard entry={completionEntry()} onToggleCompletion={onToggleCompletion} />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "タスクA" }), { key: "x" });
    expect(onToggleCompletion).not.toHaveBeenCalled();
  });
});
