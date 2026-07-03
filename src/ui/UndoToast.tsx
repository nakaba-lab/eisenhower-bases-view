/**
 * UndoToast — 移動成功直後にビュー内へ出す「元に戻す」トースト（undo・最小実装）。
 *
 * Bases・obsidian 非依存の分離した純 UI 部品（`NoteCard`/`QuadrantCell` と同じ流儀）で、
 * 表示とボタンの配線・a11y だけを担う。実際の frontmatter 復元・「直前 1 手」の保持は
 * アダプタ層（`onUndo` の委譲先＝`EisenhowerBasesView`／`UndoManager`）が持つ（UI は疎結合を維持＝AC5）。
 *
 * 移動結果のライブ通知は既存の `.eisenhower-matrix__sr-status`（`aria-live=polite`）が担う。
 * トーストを `role="status"` にすると暗黙の polite ライブ領域となり同一文言が二重読み上げされるため、
 * **非ライブの識別可能領域** `role="group"` ＋ `aria-label`（`regionLabel`）にして読み上げを sr-status に一本化する
 *（frontend-reviewer 指摘）。「元に戻す」「閉じる」は本物の `<button>`（キーボード操作可・フォーカスリング可視）。
 */
export interface UndoToastProps {
  /** 表示メッセージ（移動成功文言を流用）。 */
  message: string;
  /** トースト領域のアクセシブル名（`role="group"` の aria-label・i18n）。 */
  regionLabel: string;
  /** 「元に戻す」ボタンのラベル（i18n）。 */
  undoLabel: string;
  /** 「閉じる」ボタンのアクセシブル名（i18n）。 */
  dismissLabel: string;
  /** 「元に戻す」押下（アダプタの復元経路へ委譲）。 */
  onUndo: () => void;
  /** 「閉じる」押下・トーストを消す。 */
  onDismiss: () => void;
}

export function UndoToast({
  message,
  regionLabel,
  undoLabel,
  dismissLabel,
  onUndo,
  onDismiss,
}: UndoToastProps) {
  return (
    <div class="eisenhower-undo-toast" role="group" aria-label={regionLabel}>
      <span class="eisenhower-undo-toast__message">{message}</span>
      <button
        type="button"
        class="eisenhower-undo-toast__undo"
        onClick={onUndo}
      >
        {undoLabel}
      </button>
      <button
        type="button"
        class="eisenhower-undo-toast__dismiss"
        aria-label={dismissLabel}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
