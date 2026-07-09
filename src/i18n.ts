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
  /**
   * 書き戻し成功のライブ通知（undo 導線がある場合）。成功文言に「元に戻せる」旨と到達方法（コマンド名）を
   * 添えて、非ライブのトーストに気づけない SR/キーボード利用者にも undo の存在と到達手段を届ける（レビュー指摘 #1）。
   * `commandName` は呼び出し側が `undoCommandName` を渡す（コマンド名の真実源を一本化＝リテラル重複を避ける・レビュー指摘 #5）。
   */
  moveSucceededUndoable(title: string, label: string, commandName: string): string;
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
  /** 象限の件数バッジのアクセシブル名（例: "5 items" / "5 件"）。 */
  itemCount: (count: number) => string;
  /**
   * 全カードが未分類だが未分類ゾーンを非表示にしている（ready なのに何も見えない）ときのヒント。
   * 無言の空表示を避ける（レビュー指摘）。
   */
  unclassifiedHidden(count: number): string;
  /**
   * 両軸が同一の書き戻し可能プロパティを指す設定ミスの警告バナー文言（#103 F7）。
   * 原因（同一プロパティ名を名指し）＋直し方（別々のプロパティを指定）を平文で伝える。
   */
  diagSharedAxisWarning(sharedAxisKey: string): string;
  /** 解決済みの緊急度／重要度軸名を控えめに提示する 1 行（空状態・未分類ヒント用・#103 F7）。 */
  diagAxisNames(urgentAxis: string, importantAxis: string): string;
  /** 「ラベル（軸ラベル）」の言語別ジョイナ（英=半角括弧・日=全角括弧）。象限領域名・設定行名で共有。 */
  labelWithAxis(label: string, axisLabel: string): string;
  /** 非 boolean 軸値のため移動できないカードのアクセシブル名（データ破壊防止ガード）。 */
  cardLockedLabel: (title: string) => string;
  /** アダプタ層 Notice: 対象ファイルが見つからず移動できない。 */
  fileNotFoundForMove: string;
  /** アダプタ層 Notice: 対象ファイルが見つからず開けない。 */
  fileNotFoundForOpen: string;
  /** アダプタ層 Notice: 書き戻せない軸（note. 以外）のため移動できない。 */
  axisNotWritable: string;
  /** アダプタ層 Notice: frontmatter 書き戻しに失敗（ロールバック）。 */
  writeBackFailed: string;
  /** アダプタ層 Notice: ノートを開けなかった。 */
  openFailed: string;
  /** アダプタ層 Notice: Bases が無効でカスタムビューを登録できなかった（登録失敗フォールバック）。 */
  basesUnavailable: string;
  /** 設定タブ（#23 F6）の各文言（見出し・名前・説明・ツールチップ）。 */
  settings: SettingsMessages;
  /** Bases Configure view の軸プロパティセレクタ displayName（viewOptions）。 */
  axisOption: { urgency: string; important: string };
}

/** 設定タブの i18n 文言（見出し・設定名・説明・ツールチップ）。 */
export interface SettingsMessages {
  axisHeading: string;
  urgencyName: string;
  urgencyDesc: string;
  importanceName: string;
  importanceDesc: string;
  displayHeading: string;
  showUnclassifiedName: string;
  showUnclassifiedDesc: string;
  quadrantHeading: string;
  quadrantRowDesc: string;
  resetTooltip: string;
  languageHeading: string;
  languageName: string;
  languageDesc: string;
  /** 言語ドロップダウンの "Auto"（自動）選択肢ラベル。en/日 の endonym（English/日本語）は翻訳しない。 */
  languageAuto: string;
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
  moveSucceededUndoable: (title, label, commandName) =>
    `「${title}」を ${label} へ移動しました。コマンド「${commandName}」で元に戻せます。`,
  moveFailed: (title) => `「${title}」の移動に失敗しました。元に戻しました。`,
  undoRegionLabel: "移動の取り消し",
  undoMove: "元に戻す",
  undoDismiss: "閉じる",
  undoCommandName: "直前の移動を元に戻す",
  noUndo: "元に戻せる移動がありません。",
  undone: (title) => `「${title}」の移動を元に戻しました。`,
  undoFailed: (title) => `「${title}」の移動を元に戻せませんでした。`,
  itemCount: (count) => `${count} 件`,
  unclassifiedHidden: (count) =>
    `${count} 件のノートが未分類です（未分類ゾーンは非表示設定です。設定で表示にするか、軸プロパティを確認してください）。`,
  diagSharedAxisWarning: (sharedAxisKey) =>
    `緊急度軸と重要度軸が同じプロパティ（${sharedAxisKey}）を指しています。ビュー options かプラグイン設定で、2 つの軸に別々のプロパティを指定してください。`,
  diagAxisNames: (urgentAxis, importantAxis) =>
    `緊急度: ${urgentAxis} ／ 重要度: ${importantAxis}`,
  labelWithAxis: (label, axisLabel) => `${label}（${axisLabel}）`,
  cardLockedLabel: (title) => `「${title}」（移動不可: 対応していない軸の値）`,
  fileNotFoundForMove: "対象ファイルが見つからないため移動できません。",
  fileNotFoundForOpen: "対象ファイルが見つからないため開けません。",
  axisNotWritable:
    "軸プロパティの設定が不正（note. 以外、または両軸に同じプロパティ）のため移動できません。",
  writeBackFailed: "書き戻しに失敗しました。元に戻します。",
  openFailed: "ノートを開けませんでした。",
  basesUnavailable: "Bases が無効なためビューを登録できませんでした。",
  settings: {
    axisHeading: "軸（デフォルト）",
    urgencyName: "緊急度プロパティ",
    urgencyDesc: "ビュー未設定時に使う緊急度軸の frontmatter プロパティ名。",
    importanceName: "重要度プロパティ",
    importanceDesc: "ビュー未設定時に使う重要度軸の frontmatter プロパティ名。",
    displayHeading: "表示",
    showUnclassifiedName: "欠損ノートを未分類に表示",
    showUnclassifiedDesc: "軸プロパティを持たないノートを未分類ゾーンに表示する。",
    quadrantHeading: "象限ラベル・色",
    quadrantRowDesc: "象限のラベルとアクセント色（色未設定時はテーマのアクセント色を使用）。",
    resetTooltip: "既定に戻す（ラベル・色）",
    languageHeading: "言語",
    languageName: "表示言語",
    languageDesc: "「自動」は Obsidian の表示言語に追従します。",
    languageAuto: "自動",
  },
  axisOption: { urgency: "緊急度軸プロパティ", important: "重要度軸プロパティ" },
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
  moveSucceededUndoable: (title, label, commandName) =>
    `Moved "${title}" to ${label}. Run the "${commandName}" command to revert it.`,
  moveFailed: (title) => `Failed to move "${title}". Reverted.`,
  undoRegionLabel: "Undo move",
  undoMove: "Undo",
  undoDismiss: "Dismiss",
  undoCommandName: "Undo last move",
  noUndo: "No move to undo.",
  undone: (title) => `Reverted the move of "${title}".`,
  undoFailed: (title) => `Failed to revert the move of "${title}".`,
  itemCount: (count) => `${count} ${count === 1 ? "item" : "items"}`,
  unclassifiedHidden: (count) =>
    `${count} ${count === 1 ? "note is" : "notes are"} unclassified (the unclassified zone is hidden). Enable it in settings, or check the axis properties.`,
  diagSharedAxisWarning: (sharedAxisKey) =>
    `The urgency and importance axes both point to the same property (${sharedAxisKey}). Set different properties for the two axes in the view options or plugin settings.`,
  diagAxisNames: (urgentAxis, importantAxis) =>
    `Urgency: ${urgentAxis} · Importance: ${importantAxis}`,
  labelWithAxis: (label, axisLabel) => `${label} (${axisLabel})`,
  cardLockedLabel: (title) => `"${title}" (not movable: unsupported axis value)`,
  fileNotFoundForMove: "Target file not found; cannot move.",
  fileNotFoundForOpen: "Target file not found; cannot open.",
  axisNotWritable:
    "Invalid axis configuration (not note.*, or both axes use the same property); cannot move.",
  writeBackFailed: "Failed to write back. Reverting.",
  openFailed: "Failed to open the note.",
  basesUnavailable: "Bases is disabled, so the view could not be registered.",
  settings: {
    axisHeading: "Axes (defaults)",
    urgencyName: "Urgency property",
    urgencyDesc: "Frontmatter property for the urgency axis when the view has none set.",
    importanceName: "Importance property",
    importanceDesc: "Frontmatter property for the importance axis when the view has none set.",
    displayHeading: "Display",
    showUnclassifiedName: "Show notes with missing axes as unclassified",
    showUnclassifiedDesc: "Show notes without axis properties in the unclassified zone.",
    quadrantHeading: "Quadrant labels & colors",
    quadrantRowDesc:
      "Label and accent color for the quadrant (uses the theme accent color when unset).",
    resetTooltip: "Reset to defaults (label & color)",
    languageHeading: "Language",
    languageName: "Display language",
    languageDesc: "\"Auto\" follows Obsidian's display language.",
    languageAuto: "Auto",
  },
  axisOption: { urgency: "Urgency axis property", important: "Importance axis property" },
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
