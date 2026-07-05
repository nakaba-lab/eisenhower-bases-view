import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/preact";
import type { MatrixEntry, MatrixViewModel, QuadrantPlacements } from "../bases/types";
import { DEFAULT_SETTINGS } from "../settings";
import { messagesFor, type Language } from "../i18n";
import { resolvePresentation } from "../bases/presentation";
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
  // 進行中の KeyboardSensor ドラッグを Escape で確定的にキャンセルし、dnd-kit が document/window に
  // 張ったリスナーを回収する（dnd-kit は unmount では detach せず handleEnd/handleCancel でのみ detach
  // するため、掴んだまま終わるテストのリスナーが次テストへ漏れて二重ハンドリングを起こすのを防ぐ・レビュー指摘）。
  document.dispatchEvent(
    new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true, cancelable: true }),
  );
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

describe("MatrixView render — 未分類非表示時の無言空表示を避けるヒント（レビュー指摘）", () => {
  it("render — 全象限空＋未分類非表示＋未分類にカードあり なら件数入りヒントを出す（無言にしない）", () => {
    // given: showUnclassified=false で、可視カードは全て未分類（4 象限が空）
    const container = mountContainer();
    const viewModel: MatrixViewModel = {
      ...readyViewModel({ unclassified: [entry("x.md", "x"), entry("y.md", "y")] }),
      showUnclassified: false,
      presentation: resolvePresentation(DEFAULT_SETTINGS, messagesFor("ja")),
    };
    // when
    render(container, viewModel, {});
    // then: 未分類ゾーンは非表示だが、無言にせず件数入りヒントを出す
    expect(container.querySelector('[aria-label^="未分類"]')).toBeNull();
    const hint = container.querySelector(".eisenhower-matrix__unclassified-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("2 件");
  });

  it("render — 象限にカードがあればヒントは出さない（無言ではないため）", () => {
    // given: 未分類にカードがあっても、象限にカードがあれば画面は無言でない
    const container = mountContainer();
    const viewModel: MatrixViewModel = {
      ...readyViewModel({ do: [entry("a.md", "a")], unclassified: [entry("x.md", "x")] }),
      showUnclassified: false,
    };
    // when
    render(container, viewModel, {});
    // then
    expect(container.querySelector(".eisenhower-matrix__unclassified-hint")).toBeNull();
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

describe("MatrixView render — presentation（ラベル/色/言語文言・#23 F6）", () => {
  function presentationWith(
    labels: Record<string, string>,
    colors: Record<string, string> = {},
    lang: Language = "en",
  ) {
    return resolvePresentation(
      {
        ...DEFAULT_SETTINGS,
        quadrantLabels: { ...DEFAULT_SETTINGS.quadrantLabels, ...labels },
        quadrantColors: { ...DEFAULT_SETTINGS.quadrantColors, ...colors },
      },
      messagesFor(lang),
    );
  }

  it("render — presentation.messages で loading 文言が言語化される（en）", () => {
    const container = mountContainer();
    render(
      container,
      {
        state: "loading",
        entries: [],
        placements: emptyPlacements(),
        presentation: presentationWith({}, {}, "en"),
      },
      {},
    );
    expect(container.textContent).toContain("Loading…");
  });

  it("render — presentation.messages で empty 文言が言語化される（en）", () => {
    const container = mountContainer();
    render(
      container,
      {
        state: "empty",
        entries: [],
        placements: emptyPlacements(),
        presentation: presentationWith({}, {}, "en"),
      },
      {},
    );
    expect(container.textContent).toContain("No notes to display");
  });

  it("render — presentation の象限ラベル（カスタム上書き・空は言語既定）を描画する", () => {
    // given: do をカスタム、他は en 既定
    const container = mountContainer();
    const vm: MatrixViewModel = {
      ...readyViewModel({ do: [entry("a.md", "a")] }),
      presentation: presentationWith({ do: "やることA" }, {}, "en"),
    };
    // when
    render(container, vm, {});
    // then: Do セルはカスタム "やることA"、Schedule は en 既定 "Schedule"
    expect(container.querySelector('[aria-label^="やることA"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="Schedule"]')).not.toBeNull();
  });

  it("render — presentation の象限色をセルにインライン CSS 変数で付与する（AC2）", () => {
    // given: Do に色を指定
    const container = mountContainer();
    const vm: MatrixViewModel = {
      ...readyViewModel({ do: [entry("a.md", "a")] }),
      presentation: presentationWith({}, { do: "#123456" }, "en"),
    };
    // when
    render(container, vm, {});
    // then
    const doCell = container.querySelector('[aria-label^="Do"]') as HTMLElement;
    expect(doCell.style.getPropertyValue("--eisenhower-quadrant-accent")).toBe("#123456");
  });

  it("render — presentation 省略時は従来どおり日本語既定の文言/ラベルを描画する（後方互換）", () => {
    // given / when: presentation なし
    const container = mountContainer();
    render(container, readyViewModel({}), {});
    // then: 現行のハードコード（Do ラベル・未分類）を維持
    expect(container.querySelector('[aria-label^="Do"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="未分類"]')).not.toBeNull();
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

describe("MatrixView — DragOverlay の body への portal（#43 回帰ガード）", () => {
  // #43: DragOverlay を DndContext 直下（＝Obsidian の .workspace-leaf 内）に置くと、leaf の
  // contain:strict が position:fixed の包含ブロックになり座標原点がずれる。createPortal で
  // ビューの ownerDocument.body へ出して原点をビューポートへ戻すのが本 fix。視覚的オフセットそのものは
  // jsdom に描画エンジンが無く検証不能（実機/frontend-reviewer・E2E ハーネスで担保）だが、DOM 配置
  //（overlay が render コンテナの外＝body 側へ出る／unmount で撤去される／ビューの ownerDocument の body
  // に出る＝グローバル document.body 固定ではない）は KeyboardSensor（Space・keydown ベースで PointerEvent
  // 不要）経由で固定できる。将来 portal ラッパを外す/document.body グローバル固定へ戻す回帰を CI で捕らえる。

  const SPACE = { code: "Space", key: " ", bubbles: true, cancelable: true };
  const ESCAPE = { code: "Escape", key: "Escape", bubbles: true, cancelable: true };

  // カードを Space で掴む（KeyboardSensor 活性化）。overlay 出現を waitFor でポーリングして card を返す
  //（固定 sleep のフレーキーを避ける。活性化→setActiveId→overlay 描画は Preact の render flush 後）。
  async function grabFirstCard(container: HTMLElement): Promise<HTMLElement> {
    const card = container.querySelector('[role="button"]') as HTMLElement;
    const otherBody = card.ownerDocument.body;
    card.focus();
    card.dispatchEvent(new KeyboardEvent("keydown", SPACE));
    // overlay の「出現」を待つ。どの document.body に出たか（グローバル or ビューの ownerDocument）は
    // 各テストの明示アサーションで判定するため、ここでは両方を見る（片方に限定すると回帰時に waitFor が
    // timeout で落ち "overlay 未描画" と誤診断になり、明示 assert が死にコードになる・レビュー指摘）。
    await waitFor(() => {
      const shown =
        otherBody.querySelector(".eisenhower-note-card--overlay") ??
        document.body.querySelector(".eisenhower-note-card--overlay");
      if (!shown) throw new Error("overlay 未描画");
    });
    // dnd-kit は KeyboardSensor の document keydown リスナーを setTimeout(0) 遅延で attach する
    //（overlay 描画は同期経路のため waitFor 解決時点ではまだ未 attach）。ここで 1 マクロタスク flush して
    // attach を確定させ、後続の Escape cancel が実際にドラッグを終了しリスナーを回収できるようにする
    //（さもないと Escape は空振りし、リーク回収が実行順依存になる・レビュー指摘）。
    await new Promise((resolve) => setTimeout(resolve));
    return card;
  }

  it("ドラッグ中（Space で掴む）にオーバーレイが render コンテナの外＝body 側へ portal される", async () => {
    const container = mountContainer();
    render(container, readyViewModel({ do: [entry("do.md", "掴むカード")] }), {});
    // 掴む前は overlay 無し
    expect(document.querySelector(".eisenhower-note-card--overlay")).toBeNull();
    const card = await grabFirstCard(container);
    // overlay が出て、かつ container の外（body 側）に portal されている（象限の overflow:hidden を回避）
    const overlay = document.querySelector(".eisenhower-note-card--overlay");
    expect(overlay).not.toBeNull();
    expect(container.contains(overlay)).toBe(false);
    // ドラッグを cancel してセンサーのリスナーを回収し、unmount で preact の unmount ライフサイクル
    //（effect cleanup）も走らせる（test2/test3 と対称。DOM を innerHTML="" で剥がすだけの掃除にしない）。
    card.dispatchEvent(new KeyboardEvent("keydown", ESCAPE));
    unmount(container);
  });

  it("unmount するとポータルした body 側オーバーレイ DOM が撤去される（残骸なし＝AC4 の DOM 部分）", async () => {
    const container = mountContainer();
    render(container, readyViewModel({ do: [entry("do.md", "掴むカード")] }), {});
    await grabFirstCard(container);
    expect(document.querySelector(".eisenhower-note-card--overlay")).not.toBeNull();
    // ドラッグ中にビューを破棄しても body に overlay の DOM 残骸が残らない（preact の portal cleanup）。
    // dnd-kit センサーのリスナー回収は unmount では起きないため afterEach の Escape が担う（別レイヤ）。
    unmount(container);
    expect(document.querySelector(".eisenhower-note-card--overlay")).toBeNull();
  });

  it("portal 先はグローバル document.body ではなくビューの ownerDocument.body（別 document で確認）", async () => {
    // 2dfbb2d の実変更（document.body → matrixSectionRef.current?.ownerDocument.body）の
    // 「ownerDocument.body 分岐」を固定する。単一 document の jsdom では ownerDocument.body===document.body
    // で区別できないため、別 document(createHTMLDocument) に container を置き、overlay がグローバル
    // document.body ではなくその別 document.body に出ることを確認する（document.body 固定へ revert すると
    // 下の明示 assert が FAIL する）。
    // 注1: これは portal 先の解決分岐を固定するもので、実 Obsidian の popout ドラッグ（センサーの別 document
    //       解決＝#44・未対応）そのものは検証しない（grab は otherDoc カードへ native Space を直接 dispatch し
    //       て #44 を迂回する）。ui.md の #43 portal 項がいう「先取り担保」と同義。
    // 注2: cross-document の cleanup は jsdom が createHTMLDocument 間で HTMLElement 同一性を共有する挙動に
    //       依存する（将来 jsdom が realm を分離したら要見直し）。
    const otherDoc = document.implementation.createHTMLDocument("popout");
    const container = otherDoc.createElement("div");
    otherDoc.body.appendChild(container);
    render(container, readyViewModel({ do: [entry("do.md", "掴むカード")] }), {});
    const card = await grabFirstCard(container);
    // ビュー自身の document.body に出て、グローバル document.body には出ない
    expect(otherDoc.body.querySelector(".eisenhower-note-card--overlay")).not.toBeNull();
    expect(document.body.querySelector(".eisenhower-note-card--overlay")).toBeNull();
    // 別 document のドラッグを cancel（afterEach のグローバル Escape は otherDoc に届かないため明示）
    card.dispatchEvent(new KeyboardEvent("keydown", ESCAPE));
    unmount(container);
  });

  it("キーボードドラッグ中（Space で掴んだ後）の Enter は『開く』を発火しない（NoteCard の !isDragging ガード・レビュー指摘）", async () => {
    // given: onOpenCard を配線したカードを Space で掴む（isDragging=true になる）
    const onOpenCard = vi.fn();
    const container = mountContainer();
    render(container, readyViewModel({ do: [entry("do.md", "掴むカード")] }), { onOpenCard });
    const card = await grabFirstCard(container);
    // when: 掴んだまま Enter を押す（掴んだままノートが開くとドラッグが宙ぶらりんになる回帰を防ぐ）
    const ENTER = { code: "Enter", key: "Enter", bubbles: true, cancelable: true };
    card.dispatchEvent(new KeyboardEvent("keydown", ENTER));
    // then: ドラッグ中の Enter は dnd-kit へ委譲され、開く導線は発火しない
    expect(onOpenCard).not.toHaveBeenCalled();
    // 後片付け: ドラッグを cancel してセンサーのリスナーを回収する
    card.dispatchEvent(new KeyboardEvent("keydown", ESCAPE));
    unmount(container);
  });

  it("掴んでいないカードの Enter は『開く』を発火する（!isDragging ガードの対照・非ドラッグ時は従来どおり）", () => {
    // given: 掴んでいない（isDragging=false）カード
    const onOpenCard = vi.fn();
    const container = mountContainer();
    render(container, readyViewModel({ do: [entry("do.md", "開くカード")] }), { onOpenCard });
    const card = container.querySelector('[role="button"]') as HTMLElement;
    // when: Space で掴まずに Enter
    card.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Enter", key: "Enter", bubbles: true, cancelable: true }),
    );
    // then: 現在のリーフで開く（newLeaf=false）
    expect(onOpenCard).toHaveBeenCalledWith("do.md", { newLeaf: false });
    unmount(container);
  });
});
