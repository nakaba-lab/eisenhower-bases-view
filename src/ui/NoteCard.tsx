import { useDraggable } from "@dnd-kit/core";
import type { JSX } from "preact";
import type { MatrixEntry } from "../bases/types";
import { isOpenKey, openLeafIntent } from "./cardInteraction";

/**
 * 1 ノートのカード。dnd-kit の `useDraggable` でドラッグ可能にする（#20 F3）。
 *
 * `attributes`（`role="button"`/`tabIndex`/`aria-*`）と `listeners` は**内側の要素**に展開する。
 * dnd-kit が付ける `role="button"` を外側の `<li>` に乗せると `<ul>` のリスト意味論
 *（件数・項目位置）が失われるため、`<li>` は listitem のまま保ち、ドラッグ可能要素を内側に置く
 *（レビュー指摘 #9）。マウスだけでなく**キーボードでも掴んで移動**できる（AC5）。
 *
 * #22（F5）で**開く/プレビュー**導線を追加: 素のクリック/Enter で現在のリーフ、Cmd・Ctrl+ で新タブ
 *（`onOpenCard`）。ホバーで core page-preview（`onHoverCard`）。掴む（ドラッグ）は Space に整理し
 * Enter を「開く」に解放する（`MatrixView` で `KeyboardSensor` の起動キーを Space のみに remap）。
 * native `title` は撤去し、ホバーはコアプレビューへ一本化する。開く/preview の実処理はアダプタへ委譲（AC5）。
 */
export interface NoteCardProps {
  entry: MatrixEntry;
  /** クリック/Enter で開く（#22 F5）。UI は修飾キーから `newLeaf` を算出して渡す。 */
  onOpenCard?: (entryId: string, opts: { newLeaf: boolean }) => void;
  /** ホバーでページプレビュー（#22 F5）。`targetEl` はプレビュー位置決めのカード要素。 */
  onHoverCard?: (entryId: string, targetEl: HTMLElement, event: MouseEvent) => void;
}

export function NoteCard({ entry, onOpenCard, onHoverCard }: NoteCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
  });
  const className =
    "eisenhower-note-card" +
    (isDragging ? " eisenhower-note-card--dragging" : "");
  // dnd-kit の attributes（role:string）/listeners は React 型のため、
  // Preact の div 属性型へ寄せて展開する（role/tabindex/aria-* とキーボード操作を付与＝AC5）。
  const dndAttributes = attributes as unknown as JSX.HTMLAttributes<HTMLDivElement>;
  const dndListeners = (listeners ?? {}) as unknown as JSX.HTMLAttributes<HTMLDivElement>;
  // KeyboardSensor の掴み（ドラッグ開始）listener。Enter 以外（Space 等）はこれへ委譲する。
  const dndKeyDown = dndListeners.onKeyDown as
    | ((event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => void)
    | undefined;

  // クリックで開く（素=現在のリーフ／Cmd・Ctrl+=新タブ＝AC1/AC2）。
  const handleClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onOpenCard?.(entry.id, openLeafIntent(event));
  };
  // Enter で開く（AC4）。ただし**キーボードでドラッグ中**（Space で掴んだ最中）の Enter は開かず、
  // dnd-kit へ委譲する（掴んだまま別リーフが開いてドラッグが宙ぶらりんになるのを防ぐ＝レビュー指摘。
  // ドロップは Space/Tab、キャンセルは Esc）。それ以外のキー（Space=掴む 等）も dnd-kit へ委譲する。
  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (isOpenKey(event) && !isDragging) {
      event.preventDefault();
      onOpenCard?.(entry.id, openLeafIntent(event));
      return;
    }
    dndKeyDown?.(event);
  };
  // ホバーで core page-preview を起動（AC3）。表示可否はユーザーのコア設定に委ねる。
  const handleMouseEnter = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    onHoverCard?.(entry.id, event.currentTarget, event);
  };

  return (
    <li class="eisenhower-note-card-item">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions --
          dnd-kit の attributes が role="button"/tabIndex/aria-* を、listeners がキーボード/ポインタ操作を
          実行時に付与する（spread のため静的解析には見えない）。role・タブ・マウス・キーボード・タッチは
          いずれも満たしており（onClick/onKeyDown/onMouseEnter＋touch-action）、開く導線を足した false positive。 */}
      <div
        ref={setNodeRef}
        class={className}
        {...dndAttributes}
        {...dndListeners}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
      >
        {entry.title}
      </div>
    </li>
  );
}
