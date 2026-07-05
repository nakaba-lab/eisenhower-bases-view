# ブラウザ・プレビュー / E2E ハーネス（`scripts/preview`）

実 Obsidian を介さず、本物の `MatrixView`（`src/ui`）をモック ViewModel でブラウザ描画して、
レイアウト・テーマ・状態・ドラッグ挙動を目視／自動検証するハーネス。`frontend-reviewer` 用のスクショ取得と、
**#43（DragOverlay の座標原点ずれ）のブラウザ E2E 再現**に使う。

実機 Obsidian を CDP で駆動する E2E は別ディレクトリ（`scripts/e2e/`）。こちらは実機を使わないブラウザ再現。

## ビルド & 起動

```bash
# 1) バンドル生成（scripts/preview/preview.bundle.js を作る。gitignore 対象＝コミットしない）
npm run preview:build          # = node scripts/preview/build.mjs

# 2) リポジトリ「ルート」から HTTP サーバを起動（../../styles.css 等の相対パスを解決するためルートで serve）
python -m http.server 8765 --bind 127.0.0.1
```

## 開くページ

- **レイアウト/テーマ/状態の確認**: <http://127.0.0.1:8765/scripts/preview/index.html>
  - クエリで切替: `?theme=dark`（ダーク）／`?states=1`（ドラッグ視覚フィードバック）／
    `?f6=1&lang=ja|en`（象限色・i18n ラベル）／`?undo=1`（元に戻すトースト）
- **#43 の contain:strict E2E 再現**: <http://127.0.0.1:8765/scripts/preview/preview-contain.html>
  - `#root` を `contain: strict`・オフセット付きの `#leaf`（実機の `.workspace-leaf` を模す）で包み、
    `position: fixed` の包含ブロックが原点をリーフ左上へずらす #43 の状況を実ブラウザで再現する。
  - 実ドラッグで、DragOverlay がビューの `ownerDocument.body` へ portal されカーソルに追従（ずれ 0px）する
    ことを確認できる（修正前＝DndContext 直下だと leaf オフセット分ずれる）。
  - 取得済み証跡: `docs/screenshots/43-drag-overlay-contain-e2e.png`。設計は `docs/design/ui.md` の
    「ドラッグの視覚追従（DragOverlay）」節と「主要な設計判断」の portal 項。

> `preview.bundle.js` はビルド生成物（`.gitignore` 済み）。ソースは `preview.tsx`。UI を変更したら
> `npm run preview:build` で作り直してから開く。
