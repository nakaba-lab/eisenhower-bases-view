/**
 * ビジュアル検証用プレビュー（#19 F2 / #20 F3 / #23 F6）。
 *
 * 実 Obsidian を介さず、本物の MatrixView（src/ui）をモック ViewModel で描画して
 * 2×2 グリッド＋未分類ゾーンのレイアウト・テーマ追従・状態（空セル）を目視する。
 * MatrixView の依存は preact / dnd-kit / src/bases/types（型のみ）で obsidian 非依存のため
 * そのままブラウザにバンドルできる（frontend-reviewer 用スクショ取得）。
 *
 * `?states=1` で #20 のドラッグ視覚フィードバック（ドロップ可ハイライト・ドラッグ中の半透明）
 * を強制適用してスクショに写す（実ドラッグ操作・キーボード DnD・Notice は実機/手動で検証）。
 *
 * #23（F6）: `?f6=1` で presentation（象限ごとのカスタム色＋i18n ラベル）を適用して「after」を写す。
 * `?lang=ja|en` で言語既定ラベル（実行/計画… vs Do/Schedule…）を切り替える。`do` は
 * カスタムラベルで上書きし、言語切替でも保持されること（残りは言語既定）を目視する。
 * 設定タブ本体は Obsidian 標準 `Setting` のため実機/手動で確認する（ここでは描画しない）。
 */
import { render as preactRender } from "preact";
import { render } from "../../src/ui/MatrixView";
import { UndoToast } from "../../src/ui/UndoToast";
import { resolvePresentation } from "../../src/bases/presentation";
import { messagesFor, type Language } from "../../src/i18n";
import { DEFAULT_SETTINGS } from "../../src/settings";
import type { MatrixEntry, MatrixViewModel } from "../../src/bases/types";

function entry(id: string, title: string, locked?: boolean): MatrixEntry {
  return {
    id,
    title,
    urgent: undefined,
    important: undefined,
    ...(locked ? { locked: true } : {}),
  };
}

const params = new URLSearchParams(location.search);
const useF6 = params.get("f6") === "1";
const lang: Language = params.get("lang") === "en" ? "en" : "ja";

/** #23 F6: 象限ごとのカスタムアクセント色＋`do` のカスタムラベル上書きを施した設定。 */
const f6Settings = {
  ...DEFAULT_SETTINGS,
  language: lang,
  quadrantLabels: {
    ...DEFAULT_SETTINGS.quadrantLabels,
    do: "今すぐやる", // カスタム上書き（言語切替でも保持・残りは言語既定）
  },
  quadrantColors: {
    do: "#d9584f",
    schedule: "#2f9e6f",
    delegate: "#d9a441",
    delete: "#7d8590",
  },
};

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
      // 非 boolean 軸値のカード（locked）: 淡色＋🔒 でドラッグ不可の視覚状態をスクショに写す
      // （データ破壊防止 UI の回帰を frontend-reviewer が目視検知できるようにする・レビュー指摘）。
      entry("num.md", "数値軸のノート（移動不可）", true),
    ],
  },
  // f6 のときだけ presentation を載せる（未指定＝before＝現行のフォールバック挙動）。
  ...(useF6
    ? { presentation: resolvePresentation(f6Settings, messagesFor(lang)) }
    : {}),
};

const root = document.getElementById("root");
if (root) {
  render(root, viewModel, {});

  // #20: ドラッグ視覚フィードバックを ?states=1 で強制適用（静止画に写すため）。
  if (params.get("states") === "1") {
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

  // undo（最小実装）: ?undo=1 で「元に戻す」トースト（UndoToast）をマトリクス下部に描画して
  // 静止画に写す（実際の表示は移動成功時の内部状態で出るため、分離コンポーネントを直接描画する）。
  if (params.get("undo") === "1") {
    const section = root.querySelector<HTMLElement>(".eisenhower-matrix");
    if (section) {
      const messages = messagesFor(lang);
      const holder = document.createElement("div");
      section.appendChild(holder);
      preactRender(
        <UndoToast
          message={messages.moveSucceeded(
            "請求書を今日中に送る",
            lang === "ja" ? "実行" : "Do",
          )}
          regionLabel={messages.undoRegionLabel}
          undoLabel={messages.undoMove}
          dismissLabel={messages.undoDismiss}
          onUndo={() => {}}
          onDismiss={() => {}}
        />,
        holder,
      );
    }
  }
}
