/**
 * aria-live ステータス領域の文言更新（純関数）。
 *
 * `aria-live` 領域は **DOM テキストが変化したとき**にだけスクリーンリーダーが読み上げる。
 * 同じ文言を続けて設定すると（例: 同名ノートを同じ象限へ連続移動／同一カードの失敗反復）、
 * Preact が同値で再レンダリングを打ち切り DOM テキストが変わらず、2 回目以降が**読み上げられない**。
 * これを避けるため、文言末尾に**不可視のゼロ幅スペース（U+200B）を交互に付け外し**して、
 * 同一文言でも DOM テキストを必ず差分化する（ゼロ幅スペースはスクリーンリーダーが読み上げない）。
 *
 * `prevLive`（前回レンダリングした live 文字列）から次の live 文字列を返す純関数。Bases/dnd-kit/
 * Preact 非依存で単体テスト可能。
 */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

export function nextAnnouncement(prevLive: string, message: string): string {
  if (message === "") return "";
  // 直前が ZWSP 終端なら外す・そうでなければ付ける＝連続呼び出しで必ず文字列が変わる。
  const marker = prevLive.endsWith(ZERO_WIDTH_SPACE) ? "" : ZERO_WIDTH_SPACE;
  return message + marker;
}
