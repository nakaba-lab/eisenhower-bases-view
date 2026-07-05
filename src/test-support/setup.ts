/**
 * vitest 用グローバル shim。
 *
 * Obsidian は実行時に `activeWindow`/`activeDocument`（現在アクティブなウィンドウ/ドキュメント＝
 * popout 別ウィンドウ対応の基点）をグローバル注入する（型は obsidian.d.ts が宣言）。jsdom には
 * 無いため、単体テストではテストの window/document へ束ねる（本番は Obsidian が正しい realm を注入する）。
 * jsdom では window がグローバルオブジェクトのため、window へ設定すれば bare `activeDocument` 参照が解決される。
 */
Object.assign(window, {
  activeWindow: window,
  activeDocument: window.document,
});
