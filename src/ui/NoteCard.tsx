import { useDraggable } from "@dnd-kit/core";
import type { JSX } from "preact";
import type { MatrixEntry } from "../bases/types";

/**
 * 1 ノートのカード。dnd-kit の `useDraggable` でドラッグ可能にする（#20 F3）。
 *
 * `attributes`（`role`/`tabIndex`/`aria-*`）と `listeners` を要素に展開することで、
 * マウスだけでなく**キーボードでも掴んで移動**できる（AC5。実操作の検証は手動/frontend-reviewer）。
 * 未分類ゾーンのカードも draggable で、象限へドロップすると分類できる（人間承認）。
 * クリックで開く導線は F5（#22）で別途追加する。
 */
export interface NoteCardProps {
  entry: MatrixEntry;
}

export function NoteCard({ entry }: NoteCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
  });
  const className =
    "eisenhower-note-card" +
    (isDragging ? " eisenhower-note-card--dragging" : "");
  // dnd-kit の attributes（role:string）/listeners は React 型のため、
  // Preact の li 属性型へ寄せて展開する（role/tabindex/aria-* とキーボード操作を付与＝AC5）。
  const dndAttributes = attributes as unknown as JSX.HTMLAttributes<HTMLLIElement>;
  const dndListeners = (listeners ?? {}) as unknown as JSX.HTMLAttributes<HTMLLIElement>;
  return (
    <li
      ref={setNodeRef}
      class={className}
      title={entry.title}
      {...dndAttributes}
      {...dndListeners}
    >
      {entry.title}
    </li>
  );
}
