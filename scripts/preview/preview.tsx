/**
 * ビジュアル検証用プレビュー（#19 F2 / #20 F3）。
 *
 * 実 Obsidian を介さず、本物の MatrixView（src/ui）をモック ViewModel で描画して
 * 2×2 グリッド＋未分類ゾーンのレイアウト・テーマ追従・状態（空セル）を目視する。
 * MatrixView の依存は preact / dnd-kit / src/bases/types（型のみ）で obsidian 非依存のため
 * そのままブラウザにバンドルできる（frontend-reviewer 用スクショ取得）。
 *
 * `?states=1` で #20 のドラッグ視覚フィードバック（ドロップ可ハイライト・ドラッグ中の半透明）
 * を強制適用してスクショに写す（実ドラッグ操作・キーボード DnD・Notice は実機/手動で検証）。
 */
import { render } from "../../src/ui/MatrixView";
import type { MatrixEntry, MatrixViewModel } from "../../src/bases/types";

function entry(id: string, title: string): MatrixEntry {
  return { id, title, urgent: undefined, important: undefined };
}

const viewModel: MatrixViewModel = {
  state: "ready",
  entries: [],
  placements: {
    do: [entry("a.md", "請求書を今日中に送る"), entry("b.md", "障害の一次対応")],
    schedule: [entry("c.md", "四半期計画のドラフト"), entry("d.md", "資格試験の勉強")],
    delegate: [entry("e.md", "議事録の清書を依頼")],
    delete: [], // 空セル（象限別プレースホルダの確認）
    unclassified: [
      entry("x.md", "軸プロパティ未設定のノート"),
      entry("Eisenhower.base", "Eisenhower"),
    ],
  },
};

const root = document.getElementById("root");
if (root) {
  render(root, viewModel, {});

  // #20: ドラッグ視覚フィードバックを ?states=1 で強制適用（静止画に写すため）。
  if (new URLSearchParams(location.search).get("states") === "1") {
    // Schedule 象限をドロップ可ハイライト（--over）にする。
    const quadrants = root.querySelectorAll<HTMLElement>(
      ".eisenhower-quadrant--quadrant",
    );
    quadrants[1]?.classList.add("eisenhower-quadrant--over");
    // Do の先頭カードをドラッグ中（半透明）にする。
    root
      .querySelector<HTMLElement>(".eisenhower-note-card")
      ?.classList.add("eisenhower-note-card--dragging");
  }
}
