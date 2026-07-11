# 総合テスト（システムテスト）記録 — v0.2.1

> `.claude/rules/testing-strategy.md`「総合（システム）」に基づくリリース前の通し検証記録。
> `docs/` 配下は Pages に自動公開されるため、実データ・内部情報・秘密は記載しない（`.claude/rules/operations.md`）。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.2.1`（暫定。直前タグ `0.2.0` 以降の `develop` 差分。`[Unreleased]` は `fix` のみ＝PATCH。「リリースノート確定」で確定） |
| 対象コミット | `97fc073`（`fix(review): v0.2 の多角的レビュー駆動堅牢化（a11y・データ安全・設計書整合） (#115)`。develop HEAD・作業ツリー clean） |
| 対象 | Milestone #2 後の PATCH（v0.2.0 リリース後、v0.2 機能の多角的レビュー〔6 観点・敵対的検証・12 巡〕で確定した a11y・データ安全・設計書整合の堅牢化。新機能なし・v0.2.0 互換） |
| 実施日 | 2026-07-11 |
| 実施環境 | 単体スイート: Node（vitest, jsdom）／実機 E2E: Obsidian 1.12.7 実機（`scripts/e2e/setup-and-run.sh`・WSLg `DISPLAY=:0`） |

## 基準

`docs/要件定義書.md` の主要機能（F1–F10）・非機能要件（**定量 SLA なし**）。本リリースは v0.2.0 の 4 機能（診断バナー・追加プロパティバッジ・完了トグル・滞留インジケータ）に対する**挙動不変の堅牢化**（アクセシビリティ改善・データ安全・設計書整合）であり、v0.2.0 で実機検証済みの往復契約・主要導線に回帰が無いことを確認する。

## 本リリースの変更概要（回帰面）

- **アクセシビリティ**: スクリーンリーダー通知（完了トグルの成否・結果状態・保護中）を移動と同じ画面内ライブ領域へ、完了操作後のフォーカスを「カードが実際に消えたか」で判定して復帰、カードのアクセシブル名をノート名のみに固定、完了ボタンを独立要素化（nested-interactive 解消）、空状態にも通知領域とフォーカス受け皿、ロックカードの `x` キー完了案内。いずれも既定オフ機能の a11y 改善で視覚レイアウトは不変。
- **データ安全性**: 完了書き戻しの TOCTOU 偽成功（表示後・操作前に非 boolean へ外部変化した稀ケースで「完了しました」と誤読）を保護中読み上げへ是正、手編集 `data.json` の前後空白付きプロパティ名を読込時にトリム（空白付きゴミキーへの書込を防止・軸/完了で対称）、滞留しきい値の非数値/全角入力の受理を厳密化。
- **i18n / DRY / 設計書**: フォールバック・情報パリティの整合、キー解決・プロパティ集約の重複解消、設計書/要件定義書の陳腐化シンボル参照の網羅是正（挙動不変）。
- いずれも**挙動不変の堅牢化**で、v0.2.0 で検証済みの往復契約（`registerBasesView` → `getValue` → 実ポインタドラッグ → `processFrontMatter` → `onDataUpdated` → 再分類 → undo）の正常系は変えない。

## 1. 全テストスイート（`npm test` / `typecheck` / `lint` / `build`）

対象コミット `97fc073`（`develop` HEAD・作業ツリー clean）で実行。

| 項目 | 結果 |
|------|------|
| `npm test`（vitest） | ✅ **451 passed**（23 files。前リリース `0.2.0` の 419 → +32。レビュー確定指摘の回帰テストを含む） |
| `npm run typecheck`（`tsc --noEmit`） | ✅ エラーなし |
| `npm run lint`（eslint＝提出前 bot 検証相当） | ✅ **0 errors**（既存の意図的 warning 1 件のみ＝decoupled 層の標準 DOM 使用〔`obsidianmd/prefer-create-el`・MatrixView.tsx〕。挙動に影響なし） |
| `npm run build`（型チェック＋esbuild 本番） | ✅ `main.js` 生成成功（113,713 bytes） |

## 2. 実機 Obsidian 往復 E2E（`scripts/e2e/setup-and-run.sh`）

**実施した**（Obsidian 1.12.7・WSLg・v0.2.1 相当 build の `main.js`）。本リリースは a11y・堅牢化の PATCH だが、対話挙動（完了操作後フォーカス・undo トースト・書き戻し往復）を含むため、既存の往復契約に回帰が無いことを実機で確認した。

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

証跡: `docs/test/v021-e2e-result.json`・`docs/screenshots/v021-e2e-01-initial.png`（初期描画）・`v021-e2e-02-after-writeback.png`（書き戻し後）・`v021-e2e-03-after-undo.png`（undo 後）。

> **E2E のスコープ**: 現行ハーネスのテスト Vault フィクスチャは**コアの往復契約**（配置・ロック・ドラッグ書き戻し・再分類・undo）を対象とする。本リリースの a11y・堅牢化の固有挙動（スクリーンリーダー通知・フォーカス復帰・非 boolean 保護・全角/空白トリム）は §1 の 451 件の単体/コンポーネントテスト（`MatrixView.test.tsx`・`NoteCard.test.tsx`・`settings.test.ts`・`readAxis.test.ts` 等）で網羅済み。実機 E2E は「堅牢化後もコアの往復契約が回帰していない」ことと「実機 Obsidian 1.12.7 が v0.2.1 build をロードして正常動作する」ことを担保する。

## 3. 性能

`docs/要件定義書.md` の非機能要件は**定量 SLA なし**。本リリースは既存機能の a11y・堅牢化（挙動不変）で描画・計算量に構造的変化はない＝定量性能テストは**該当なし**。

## 総括

自動スイート（**451 pass**）・typecheck・lint（0 error）・本番ビルドはすべて合格。実機 Obsidian 1.12.7 往復 E2E も **21/21 passed** で、v0.2 機能の堅牢化後もコアのドラッグ書き戻し往復・undo に回帰は検出されなかった。**リリース可**（版番号の確定は「リリースノート確定」で行う）。
