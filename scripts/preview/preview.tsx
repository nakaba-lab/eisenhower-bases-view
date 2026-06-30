/**
 * ビジュアル検証用プレビュー（#19 F2）。
 *
 * 実 Obsidian を介さず、本物の MatrixView（src/ui）をモック ViewModel で描画して
 * 2×2 グリッド＋未分類ゾーンのレイアウト・テーマ追従・状態（空セル）を目視する。
 * MatrixView の依存は preact と src/bases/types（型のみ）だけで obsidian 非依存のため
 * そのままブラウザにバンドルできる（frontend-reviewer 用スクショ取得）。
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
}
