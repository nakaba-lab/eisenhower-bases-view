/**
 * vitest 用グローバル shim。
 *
 * Obsidian は実行時に `activeWindow`/`activeDocument`（現在アクティブなウィンドウ/ドキュメント＝
 * popout 別ウィンドウ対応の基点）をグローバル注入する（型は obsidian.d.ts が宣言）。jsdom には
 * 無いため、単体テストではテストの window/document へ束ねる（本番は Obsidian が正しい realm を注入する）。
 */
// bare 代入は ES module の strict mode で未宣言変数への代入となり ReferenceError になるため、
// globalThis に設定する（bare `activeDocument` 参照は runtime で globalThis へ解決される）。
Object.assign(globalThis, {
  activeWindow: window,
  activeDocument: document,
});
