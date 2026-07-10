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
import type { MatrixEntry, MatrixViewModel, QuadrantPlacements } from "../../src/bases/types";

function entry(
  id: string,
  title: string,
  locked?: boolean,
  badges?: MatrixEntry["badges"],
): MatrixEntry {
  return {
    id,
    title,
    urgent: undefined,
    important: undefined,
    ...(locked ? { locked: true } : {}),
    ...(badges ? { badges } : {}),
  };
}

const params = new URLSearchParams(location.search);
const useF6 = params.get("f6") === "1";
// #104 F8: ?badges=1 でカード追加プロパティ表示（読み取り専用バッジ）を写す。
// 期日（過去日＝強調）・プロジェクト・空表示（absent 退避）・未来日（非強調）を混ぜて目視する。
const useBadges = params.get("badges") === "1";
const lang: Language = params.get("lang") === "en" ? "en" : "ja";
// #106 F9: `?stagnant=1` で滞留バッジ（時計＋経過日数）を一部カードに写す（before＝無指定・after＝指定）。
const useStagnant = params.get("stagnant") === "1";
// #103 F7: 診断表示の確認。?diag=warn（両軸同一キー＝全ロック＋警告バナー）／?diag=empty（空状態＋軸名）。
const diag = params.get("diag");

/** 滞留（#106 F9）を付与する。`useStagnant` のときだけフラグを載せ、それ以外は現行どおり（before）。 */
function stale(base: MatrixEntry, days: number): MatrixEntry {
  return useStagnant ? { ...base, stagnant: true, stagnantDays: days } : base;
}

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

/** #104 F8: バッジ検証用のサンプル（過去日=強調・プロジェクト・空表示・未来日=非強調）。ラベルは
 * プロパティ名（言語非依存）、値だけ言語で出し分ける。 */
const pastDueBadges: MatrixEntry["badges"] = [
  { label: "due", text: "2026-07-01", emphasized: true }, // 今日以前＝アクセント強調（AC4）
  { label: "project", text: lang === "ja" ? "経理" : "Finance" },
];
const futureDueBadges: MatrixEntry["badges"] = [
  { label: "due", text: "2026-08-01" }, // 未来日＝非強調
  { label: "tags", text: lang === "ja" ? "計画" : "planning" },
];
const gracefulBadges: MatrixEntry["badges"] = [
  { label: "due", text: "" }, // absent/例外の空表示退避（AC2・ラベルのみ）
  { label: "project", text: lang === "ja" ? "議事録" : "Minutes" },
];

const placements: QuadrantPlacements = {
  do: [
    entry("a.md", "請求書を今日中に送る", false, useBadges ? pastDueBadges : undefined),
    entry("b.md", "障害の一次対応"),
  ],
  // Schedule / Delegate は「置いたきり忘れる」象限。滞留カード（#106 F9）を混ぜて長タイトルの
  // truncate ＋滞留バッジ右寄せ＋#104 追加プロパティバッジの共存を frontend-reviewer が目視できるようにする。
  schedule: [
    stale(
      entry("c.md", "四半期計画のドラフトを書き上げて共有する", false, useBadges ? futureDueBadges : undefined),
      21,
    ),
    entry("d.md", "資格試験の勉強"),
  ],
  delegate: [
    stale(entry("e.md", "議事録の清書を依頼", false, useBadges ? gracefulBadges : undefined), 45),
  ],
  delete: [], // 空セル（象限別プレースホルダの確認）
  unclassified: [
    entry("x.md", "軸プロパティ未設定のノート"),
    // 非 boolean 軸値のカード（locked）: 淡色＋🔒 でドラッグ不可の視覚状態をスクショに写す
    // （データ破壊防止 UI の回帰を frontend-reviewer が目視検知できるようにする・レビュー指摘）。
    entry("num.md", "数値軸のノート（移動不可）", true),
  ],
};

// #103 F7 の診断情報（frontmatter キー表記）。
const normalDiagnostics = {
  axesShareWritableKey: false,
  urgentAxis: "urgent",
  importantAxis: "important",
};
const sharedKeyDiagnostics = {
  axesShareWritableKey: true,
  sharedAxisKey: "urgent",
  urgentAxis: "urgent",
  importantAxis: "urgent",
};

// ?diag=warn は両軸同一キー設定ミス＝全カードロック（🔒）＋警告バナーの状態を写す。
const warnPlacements = {
  do: placements.do.map((card) => ({ ...card, locked: true })),
  schedule: placements.schedule.map((card) => ({ ...card, locked: true })),
  delegate: placements.delegate.map((card) => ({ ...card, locked: true })),
  delete: placements.delete.map((card) => ({ ...card, locked: true })),
  unclassified: placements.unclassified.map((card) => ({ ...card, locked: true })),
};

// diag 表示時は文言解決のため presentation を載せる（言語は ?lang で切替）。
const diagPresentation = resolvePresentation(
  { ...(useF6 ? f6Settings : DEFAULT_SETTINGS), language: lang },
  messagesFor(lang),
);

const emptyPl = { do: [], schedule: [], delegate: [], delete: [], unclassified: [] };

let viewModel: MatrixViewModel;
if (diag === "empty") {
  // 空状態＋解決済み軸名（--text-muted の 1 行）。
  viewModel = {
    state: "empty",
    entries: [],
    placements: emptyPl,
    diagnostics: normalDiagnostics,
    presentation: diagPresentation,
  };
} else if (diag === "empty-warn") {
  // 空状態 × 設定ミス（バナーが全幅トップで出るか＝align-self:stretch の確認）。
  viewModel = {
    state: "empty",
    entries: [],
    placements: emptyPl,
    diagnostics: sharedKeyDiagnostics,
    presentation: diagPresentation,
  };
} else if (diag === "hint") {
  // 未分類ゾーン非表示 × 全ノート未分類 → unclassifiedHidden ヒント＋軸名行。
  const hintPl = { ...emptyPl, unclassified: placements.unclassified };
  viewModel = {
    state: "ready",
    entries: hintPl.unclassified,
    placements: hintPl,
    showUnclassified: false,
    diagnostics: normalDiagnostics,
    presentation: diagPresentation,
  };
} else if (diag === "warn") {
  // 全カードロック＋グリッド上部の警告バナー。
  viewModel = {
    state: "ready",
    entries: Object.values(warnPlacements).flat(),
    placements: warnPlacements,
    diagnostics: sharedKeyDiagnostics,
    presentation: diagPresentation,
  };
} else {
  viewModel = {
    state: "ready",
    // entries は placements 由来にする（空だと MatrixView の titleOf が overlay/SR アナウンスの
    // タイトル逆引きに失敗して id にフォールバックするため。#43 の DragOverlay 検証で顕在化）。
    entries: Object.values(placements).flat(),
    placements,
    // 正常時の診断（バナーは出ない＝抑制の確認）。
    diagnostics: normalDiagnostics,
    // f6 のときだけ presentation を載せる（未指定＝before＝現行のフォールバック挙動）。
    ...(useF6
      ? { presentation: resolvePresentation(f6Settings, messagesFor(lang)) }
      : {}),
  };
}

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
