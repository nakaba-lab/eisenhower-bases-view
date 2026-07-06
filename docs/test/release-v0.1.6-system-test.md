# 総合テスト（システムテスト）記録 — v0.1.6

> `.claude/rules/testing-strategy.md`「総合（システム）」に基づくリリース前の通し検証記録。
> `docs/` 配下は Pages に自動公開されるため、実データ・内部情報・秘密は記載しない（`.claude/rules/operations.md`）。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.1.6`（暫定。直前タグ `0.1.5` 以降の `develop` 差分。「リリースノート確定」で確定） |
| 対象コミット | `4ae98e4`（`fix(ui): DragOverlay 掴み時の座標ズレを包含ブロック原点補正で恒久対策 (#43 再燃) (#77)`） |
| 対象 Milestone | 運用なし（本リリースは #43 再燃の単一 fix。参考: Milestone v1 は open 0） |
| 実施日 | 2026-07-06 |
| 実施環境 | 単体スイート: Node（vitest, jsdom）／実機 E2E: Obsidian 1.12.7（Electron・Playwright `connectOverCDP`・WSLg GUI） |

## 基準

`docs/要件定義書.md` の主要機能（F1–F6）・非機能要件（**定量 SLA なし**）と、L1 Milestone v1 の成果 AC。本リリースの主眼は #43（DragOverlay の掴み座標ズレ）再燃の恒久対策で、既存機能の回帰が無いことを併せて確認する。

## 1. 全テストスイート（`npm test` / `typecheck` / `lint` / `build`）

| 項目 | 結果 |
|------|------|
| `npm test`（vitest） | ✅ **262 passed**（19 files。#43 恒久対策の純関数 `compensateOverlayTransform` 4 件＋配線回帰ガード 2 件を含む） |
| `npm run typecheck`（`tsc --noEmit`） | ✅ エラーなし |
| `npm run lint`（eslint） | ✅ エラーなし |
| `npm run build`（型チェック＋esbuild 本番） | ✅ `main.js` 生成成功 |

## 2. 実機 Obsidian 往復 E2E（`scripts/e2e/setup-and-run.sh`）

実機 Obsidian 1.12.7 に CDP 接続し、Bases カスタムビューの往復（`registerBasesView` → `getValue` → 実ポインタドラッグ → `processFrontMatter` 書き戻し → `onDataUpdated` 自動再発火 → base 再オープンでのサーバ再分類 → undo コマンドで復元）を自動検証。

| 結果 | 内容 |
|------|------|
| ✅ **21/21 checks passed** | 配置（4 象限＋未分類・locked/draggable 判定・非 md 除外）、ドラッグ書き戻し（`schedule.md` → `urgent:true/important:true`）、`onDataUpdated` 自動再発火、楽観保留なし新規描画でのサーバ再分類、undo（`urgent:true→false` 復元）まで全項目合格。#43 恒久対策（DragOverlay の modifier 追加）によるドラッグ・書き戻し・undo 経路の**回帰なし**を確認。 |

## 3. #43 恒久対策の座標検証（本リリースの主眼）

DragOverlay（`position:fixed`）の掴み時オフセットを実測（`scripts/preview/measure-shifted.mjs` ほか、実ブラウザ・実ドラッグ）。

| 条件 | 掴みオフセット |
|------|----------------|
| 実機 Obsidian 1.12.7・中央ペイン（原点 (0,0)） | **0px**（回帰なし＝no-op） |
| 実機 Obsidian 1.12.7・ポップアウト別ウィンドウ | **0px** |
| 実機 Obsidian 1.12.7・強制 DPR 1.5 | **0px** |
| 包含ブロック原点ずらし `body{transform:translate(70,45)}`（修正前は 70,45 ずれ） | **0px に是正** |
| 包含ブロック原点ずらし `html{transform:translate(0,55)}`（修正前は 0,55 ずれ） | **0px に是正** |
| 見た目 vs ドロップ判定（B=0 / B≠0 各 4 象限） | **不一致 0 件**（視覚と衝突判定が一致） |

利用者による実機目視確認済み（「想定通り解消」）。多観点レビュー（Workflow＋敵対的検証）を指摘収束まで 2 ラウンド実施（`must:` 0 件）。

## 4. 性能

`docs/要件定義書.md` の非機能要件は**定量 SLA なし**（数百ノートを快適に表示・ドラッグ／数値 SLA は持たない）。本リリースは DragOverlay の座標補正のみで描画量・計算量に実質変化なし（掴み開始 1 回の原点実測のみ）＝定量性能テストは**該当なし**。

## 総括

全テストスイート（262）・実機往復 E2E（21/21）・#43 座標検証（全条件 0px／見た目=ドロップ先一致）いずれも合格。既存機能の回帰なし、#43 再燃の恒久対策が実機・原点ずらし環境の双方で有効であることを確認した。**リリース可**（版番号の確定は「リリースノート確定」で行う）。
