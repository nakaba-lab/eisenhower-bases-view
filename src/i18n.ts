/**
 * i18n — 表示言語の解決（Auto 追従＋手動上書き）と言語別メッセージ束（#23 F6・AC4）。
 *
 * `resolveLanguage(setting, appLang)`: `en`/`ja` は明示、`auto` は Obsidian のアプリ言語
 * （`ja*` → ja、それ以外/未知/未設定 → en）に追従する。**純関数**（Obsidian ランタイム非依存）で、
 * `appLang` はアダプタ層（`main.ts`）が Obsidian から読み取って渡す。`messagesFor(lang)` は
 * 静的 UI 文言・既定象限ラベル・軸ラベル・SR 文言・アナウンステンプレートを言語別に返す。
 *
 * UI（`MatrixView`/`QuadrantCell`）はこの束を ViewModel（`presentation`）経由で受け取り、
 * 言語そのものは知らない（アダプタ側で解決＝疎結合を維持）。
 */
import { type QuadrantKey } from "./logic/quadrant";
import type { LanguageSetting } from "./settings";

/** 解決済みの表示言語（`auto` は含まない＝`resolveLanguage` で en/ja に確定済み）。 */
export type Language = "en" | "ja";

/** 1 言語ぶんのメッセージ束（静的文言・象限/軸ラベル・SR・アナウンステンプレート）。 */
export interface Messages {
  /** マトリクス領域のアクセシブル名。 */
  matrixLabel: string;
  /** ローディング状態の文言。 */
  loading: string;
  /** entries 0 件（空）状態の文言。 */
  empty: string;
  /** 各象限が 0 件のときの空プレースホルダ。 */
  emptyQuadrant: string;
  /** 未分類ゾーンの見出し。 */
  unclassifiedLabel: string;
  /** 未分類ゾーンの軸ラベル（ドロップ不可の説明）。 */
  unclassifiedAxisLabel: string;
  /** 象限の既定ラベル（カスタム未設定時に使う・言語で切り替わる＝AC4）。 */
  quadrantLabels: Record<QuadrantKey, string>;
  /** 象限の軸ラベル（重要/緊急の有無）。 */
  axisLabels: Record<QuadrantKey, string>;
  /** ドラッグ可能要素のスクリーンリーダー操作説明。 */
  screenReaderDraggable: string;
  /** 掴んだときのアナウンス。 */
  grabbed(title: string): string;
  /** 象限の上にあるときのアナウンス。 */
  over(label: string): string;
  /** ドロップ可能象限の外にあるときのアナウンス。 */
  outside: string;
  /** ドロップしたときのアナウンス。 */
  dropped(title: string, label: string): string;
  /** 元の位置に戻したときのアナウンス。 */
  returnedToOrigin(title: string): string;
  /** 移動をキャンセルしたときのアナウンス。 */
  cancelled(title: string): string;
  /** 書き戻し成功のライブ通知。 */
  moveSucceeded(title: string, label: string): string;
  /** 書き戻し失敗（ロールバック）のライブ通知。 */
  moveFailed(title: string): string;
  /** undo トーストの領域アクセシブル名（`role="group"` の aria-label・undo）。 */
  undoRegionLabel: string;
  /** undo トーストの「元に戻す」ボタンラベル（undo）。 */
  undoMove: string;
  /** undo トーストの「閉じる」ボタンのアクセシブル名（undo）。 */
  undoDismiss: string;
  /** undo コマンド（コマンドパレット）の名称（undo）。 */
  undoCommandName: string;
  /** 元に戻せる移動が無いときの Notice（undo）。 */
  noUndo: string;
  /** undo 成功の Notice（undo）。 */
  undone(title: string): string;
  /** undo 失敗の Notice（undo）。 */
  undoFailed(title: string): string;
}

const JA: Messages = {
  matrixLabel: "Eisenhower Matrix",
  loading: "読み込み中…",
  empty: "表示するノートがありません",
  emptyQuadrant: "なし",
  unclassifiedLabel: "未分類",
  unclassifiedAxisLabel: "軸欠損・ドロップ不可",
  quadrantLabels: {
    do: "実行",
    schedule: "計画",
    delegate: "委任",
    delete: "削除",
  },
  axisLabels: {
    do: "重要 × 緊急",
    schedule: "重要 × 非緊急",
    delegate: "非重要 × 緊急",
    delete: "非重要 × 非緊急",
  },
  screenReaderDraggable:
    "スペースキーで掴み、矢印キーで象限へ移動し、" +
    "スペースキーでドロップします。Esc でキャンセルします。Enter でノートを開きます。",
  grabbed: (title) => `「${title}」を掴みました。象限へ移動してください。`,
  over: (label) => `${label} の上にあります。`,
  outside: "ドロップ可能な象限の外にあります。",
  dropped: (title, label) => `「${title}」を ${label} にドロップしました。`,
  returnedToOrigin: (title) => `「${title}」を元の位置に戻しました。`,
  cancelled: (title) => `「${title}」の移動をキャンセルしました。`,
  moveSucceeded: (title, label) => `「${title}」を ${label} へ移動しました。`,
  moveFailed: (title) => `「${title}」の移動に失敗しました。元に戻しました。`,
  undoRegionLabel: "移動の取り消し",
  undoMove: "元に戻す",
  undoDismiss: "閉じる",
  undoCommandName: "直前の移動を元に戻す",
  noUndo: "元に戻せる移動がありません。",
  undone: (title) => `「${title}」の移動を元に戻しました。`,
  undoFailed: (title) => `「${title}」の移動を元に戻せませんでした。`,
};

const EN: Messages = {
  matrixLabel: "Eisenhower Matrix",
  loading: "Loading…",
  empty: "No notes to display",
  emptyQuadrant: "None",
  unclassifiedLabel: "Unclassified",
  unclassifiedAxisLabel: "No axis values · not a drop target",
  quadrantLabels: {
    do: "Do",
    schedule: "Schedule",
    delegate: "Delegate",
    delete: "Delete",
  },
  axisLabels: {
    do: "Important × Urgent",
    schedule: "Important × Not urgent",
    delegate: "Not important × Urgent",
    delete: "Not important × Not urgent",
  },
  screenReaderDraggable:
    "Press Space to pick up, use the arrow keys to move to a quadrant, " +
    "and Space to drop. Press Esc to cancel. Press Enter to open the note.",
  grabbed: (title) => `Picked up "${title}". Move it to a quadrant.`,
  over: (label) => `Over ${label}.`,
  outside: "Not over a droppable quadrant.",
  dropped: (title, label) => `Dropped "${title}" onto ${label}.`,
  returnedToOrigin: (title) => `Returned "${title}" to its original position.`,
  cancelled: (title) => `Cancelled moving "${title}".`,
  moveSucceeded: (title, label) => `Moved "${title}" to ${label}.`,
  moveFailed: (title) => `Failed to move "${title}". Reverted.`,
  undoRegionLabel: "Undo move",
  undoMove: "Undo",
  undoDismiss: "Dismiss",
  undoCommandName: "Undo last move",
  noUndo: "No move to undo.",
  undone: (title) => `Reverted the move of "${title}".`,
  undoFailed: (title) => `Failed to revert the move of "${title}".`,
};

/** 言語別メッセージ束を返す。 */
export function messagesFor(lang: Language): Messages {
  return lang === "ja" ? JA : EN;
}

/**
 * 表示言語を解決する（純関数）。`en`/`ja` は明示指定を優先し、`auto` は Obsidian の
 * アプリ言語（`appLang`）が `ja` 系なら ja、それ以外・未知・未設定は en にフォールバックする。
 */
export function resolveLanguage(
  setting: LanguageSetting,
  appLang?: string | null,
): Language {
  if (setting === "en" || setting === "ja") return setting;
  if (typeof appLang === "string" && appLang.toLowerCase().startsWith("ja")) {
    return "ja";
  }
  return "en";
}
