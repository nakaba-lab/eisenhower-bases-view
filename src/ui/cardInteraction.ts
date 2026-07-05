/**
 * カードを「開く」導線の純ヘルパー（#22 F5）。
 *
 * Bases/Obsidian・dnd-kit 非依存。修飾キー→新タブ可否（AC1/AC2）と「開くキー＝Enter のみ」
 * （AC4・Space は KeyboardSensor の掴み＝ドラッグに予約）を純関数として切り出し、UI から委譲される
 * `onOpenCard` の引数算出に使う（実際の open/preview 往復・workspace 操作はアダプタ＝手動/結合で担保）。
 */

/** `onOpenCard` に渡す「開く」意図（新タブ可否）。 */
export interface OpenLeafIntent {
  /** 新規タブ/リーフで開くか（Cmd/Ctrl 押下時 true）。false は現在のリーフ。 */
  newLeaf: boolean;
}

/** 修飾キー（mac=Cmd／win=Ctrl）から新タブ可否を決める（AC1/AC2）。 */
export function openLeafIntent(event: {
  metaKey?: boolean;
  ctrlKey?: boolean;
}): OpenLeafIntent {
  return { newLeaf: Boolean(event.metaKey || event.ctrlKey) };
}

/** 「開く」キーは Enter のみ（AC4）。Space は掴み（ドラッグ）に予約するため false を返す。 */
export function isOpenKey(event: { key: string }): boolean {
  return event.key === "Enter";
}
