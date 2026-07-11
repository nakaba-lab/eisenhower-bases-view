# 総合テスト（システムテスト）記録 — v0.2.0

> `.claude/rules/testing-strategy.md`「総合（システム）」に基づくリリース前の通し検証記録。
> `docs/` 配下は Pages に自動公開されるため、実データ・内部情報・秘密は記載しない（`.claude/rules/operations.md`）。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.2.0`（暫定。直前タグ `0.1.7` 以降の `develop` 差分。`[Unreleased]` は feat 4 件を含むため MINOR。「リリースノート確定」で確定） |
| 対象コミット | `320e374`（`feat(completion): カード上の完了トグル（boolean 完了プロパティ＋Bases 委譲） (#110)`。develop HEAD） |
| 対象 Milestone | #2「v0.2: 日常運用の完成」（open 0 / closed 4）。配下: #103 診断バナー・#104 追加プロパティバッジ・#105 完了トグル・#106 滞留インジケータ |
| 実施日 | 2026-07-11 |
| 実施環境 | 単体スイート: Node（vitest, jsdom）／実機 E2E: Obsidian 1.12.7 実機（`scripts/e2e/setup-and-run.sh`・WSLg `DISPLAY=:0`） |

## 基準

`docs/要件定義書.md` の主要機能（F1–F6）・非機能要件（**定量 SLA なし**）と、L1 Milestone v0.2「日常運用の完成」の成果 AC。本リリースは「日常運用の完成」を主眼とする 4 つの UI 機能追加（診断バナー・追加プロパティバッジ・完了トグル・滞留インジケータ）で、既存のドラッグ書き戻し往復に回帰が無いことを併せて確認する。

## 本リリースの変更概要（回帰面）

- **#103 診断バナー**（読み取り専用 UI）: 緊急度／重要度に同一プロパティを割り当てた設定ミスの警告バナー＋解決済み軸名の表示。書き込みは変えない。
- **#104 追加プロパティバッジ**（読み取り専用表示）: カードに期日・タグ等を最大 3 個バッジ表示。数式・`file.*` も表示可（読み取り専用）。既定 0 個＝既存の見た目は不変。
- **#105 完了トグル**（**新規書き戻し経路**）: 完了プロパティ（boolean・既定オフの opt-in）が有効なときチェックで `done: true/false` を `processFrontMatter` で書き込む。非 boolean 値のノートはチェック無効化。undo は既存のドラッグ移動と共通。
- **#106 滞留インジケータ**（読み取り専用）: mtime ベースの滞留バッジ（既定 14 日・0 で無効）。ノートは書き換えない。
- いずれも**既定オフ／追加的表示**が中心で、実機で検証済みの往復契約（`registerBasesView` → `getValue` → 実ポインタドラッグ → `processFrontMatter` → `onDataUpdated` → 再分類 → undo）の正常系の挙動は変えない。#105 のみ新規書き戻しだが、既存の `processFrontMatter` 機構（v0.1.0/v0.1.6/v0.2.0 の E2E で検証済み）を再利用する。

## 1. 全テストスイート（`npm test` / `typecheck` / `lint` / `build`）

対象コミット `320e374`（`develop` HEAD・作業ツリー clean）で実行。

| 項目 | 結果 |
|------|------|
| `npm test`（vitest） | ✅ **419 passed**（23 files。前リリース 273 → +146。完了トグル・滞留・バッジ・診断バナーの新規テストを含む） |
| `npm run typecheck`（`tsc --noEmit`） | ✅ エラーなし |
| `npm run lint`（eslint＝提出前 bot 検証相当） | ✅ **0 errors**（既存の意図的 warning 1 件のみ＝decoupled 層の標準 DOM 使用〔`obsidianmd/prefer-create-el`・MatrixView.tsx:310〕。挙動に影響なし） |
| `npm run build`（型チェック＋esbuild 本番） | ✅ `main.js` 生成成功（111,547 bytes） |

## 2. 実機 Obsidian 往復 E2E（`scripts/e2e/setup-and-run.sh`）

**実施した**（Obsidian 1.12.7・WSLg・v0.2.0 build の `main.js`）。本リリースは #105 で新規書き戻し（`done` プロパティ）を追加した MINOR リリースのため、既存の往復契約に回帰が無いことを実機で確認した。

| 結果 | **21/21 checks passed**（result.json: `"pass":false` 0 件） |
|------|------|

検証項目（抜粋・すべて PASS）:

- プラグイン有効化・Bases コアロード・matrix view 描画（`registerBasesView` 往復）
- 象限配置: Do=[do, infolder]（フォルダ配下ノート含む）／Schedule=[schedule]／Delegate=[delegate]／Delete=[delete]
- 未分類=[absent, partial, numeric]。numeric（非 boolean 軸）は locked（ドラッグ不可）・absent（軸欠損）は draggable
- `.base` 自己エントリ・非 md がカード化されない
- ドラッグ書き戻し: schedule.md `urgent:false→true`（`processFrontMatter` でファイル反映）→ `onDataUpdated` 自動再発火（手動再描画なし）
- 再オープンの新規描画（楽観保留なし）でサーバ再分類（stale 読み取り防止）
- undo コマンド: `urgent:true→false` へ遷移復元

証跡: `docs/test/v020-e2e-result.json`・`docs/screenshots/v020-e2e-01-initial.png`（初期描画）・`v020-e2e-02-after-writeback.png`（書き戻し後）・`v020-e2e-03-after-undo.png`（undo 後）。

> **E2E のスコープ**: 現行ハーネスのテスト Vault フィクスチャは**コアの往復契約**（配置・ロック・ドラッグ書き戻し・再分類・undo）を対象とし、本リリースの新機能（#105 完了トグルの `done` 書き戻し・#104 バッジ・#106 滞留バッジ）の固有挙動は Vault に含まない。新機能の挙動は §1 の 419 件の単体/コンポーネントテストで網羅済み（完了トグルの書き戻し・非 boolean 無効化・トグル往復・滞留 mtime 判定・バッジ表示・診断バナー）。実機 E2E は「4 新機能追加後もコアの往復契約が回帰していない」ことと「実機 Obsidian 1.12.7 が v0.2.0 build をロードして正常動作する」ことを担保する。

## 3. 性能

`docs/要件定義書.md` の非機能要件は**定量 SLA なし**。本リリースの追加は読み取り専用表示（バッジ・滞留・診断バナー）と opt-in の完了トグルで、描画・計算量に構造的変化はない。大量入力の分類正しさは既存の `toViewModel` テストで固定済み＝定量性能テストは**該当なし**。

## 総括

自動スイート（**419 pass**）・typecheck・lint（0 error）・本番ビルドはすべて合格。実機 Obsidian 1.12.7 往復 E2E も **21/21 passed** で、4 新機能追加後もコアのドラッグ書き戻し往復・undo に回帰は検出されなかった。**リリース可**（版番号の確定は「リリースノート確定」で行う）。
