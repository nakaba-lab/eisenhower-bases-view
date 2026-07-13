# 総合テスト（システムテスト）記録 — v0.2.2

> `.claude/rules/testing-strategy.md`「総合（システム）」に基づくリリース前の通し検証記録。
> `docs/` 配下は Pages に自動公開されるため、実データ・内部情報・秘密は記載しない（`.claude/rules/operations.md`）。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.2.2`（PATCH。直前タグ `0.2.1` 以降の `develop` 差分＝`fix` 1 件） |
| 対象コミット | `53bd3ba`（`fix(completion): 完了トグルを既定で有効化（既定プロパティを done に） (#133)`。`develop` HEAD・作業ツリー clean） |
| 対象 | 完了トグル（F10）の**既定を反転**（`DEFAULT_SETTINGS.completionProperty` を空〔opt-in・機能オフ〕→ `done`〔初期状態で有効〕）。利用者報告「完了プロパティを設定するまでボタンが出ない」への対応。挙動の変更はこの 1 行で、他はドキュメント/コメントの正確化。 |
| 実施日 | 2026-07-14 |
| 実施環境 | 単体スイート: Node（vitest, jsdom）／CI: GitHub Actions（PR #133 で全チェック pass） |

## 基準

`docs/要件定義書.md` の主要機能（F1–F10）・非機能要件（**定量 SLA なし**）。本リリースは既存機能 F10 の**既定値のみ**を変更する PATCH であり、v0.2.1 で検証済みの往復契約・主要導線に回帰が無いこと、および既定反転が意図どおり（既定で完了ボタンが描画され、明示的な空文字で opt-out）を確認する。

## 本リリースの変更概要（回帰面）

- **挙動変更は 1 行**: `DEFAULT_SETTINGS.completionProperty` を `""` → `"done"`。完了プロパティ設定なしでも `resolveCompletionId` が `note.done` を解決し `completionEnabled=true` となり、全カードにチェックボタンが描画される（既定軸 `note.urgent`/`note.important` とは非衝突）。
- **移行（後方互換）**: `mergePropertyName` が保存済みの明示空文字 `""` を尊重するため、v0.2 系（0.2.0/0.2.1）で設定を保存済みの環境は無効のまま維持（既定変更で勝手に有効化しない）。自動有効化は新規インストール・完了プロパティ未保存・旧 v0.1.x のみ。`loadSettings` は load 時保存しない。
- **既存ガードは不変**: 非 boolean 完了値の書き込み保護（`writeCompletion` の `typeof !== "boolean"` チェック）・書き込みは必ずユーザー操作・1 手 undo。
- ドキュメント/コメント（README・要件定義書・用語集・`docs/design/ui.md`・`bases.md`・コード内 "opt-in" 表記）を新既定に合わせて正確化（挙動不変）。

## 1. 全テストスイート（`npm test` / `typecheck` / `lint` / `build`）

対象コミット `53bd3ba`（`release/0.2.2` = `develop` HEAD・作業ツリー clean）で実行。

| 項目 | 結果 |
|------|------|
| `npm test`（vitest） | ✅ **454 passed**（23 files。前リリース `0.2.1` の 451 → +3。既定反転＋opt-out 維持の回帰テストを含む） |
| `npm run typecheck`（`tsc --noEmit`） | ✅ エラーなし |
| `npm run lint`（eslint＝提出前 bot 検証相当） | ✅ **0 errors**（既存の意図的 warning 1 件のみ＝`obsidianmd/prefer-create-el`・MatrixView.tsx。挙動に影響なし） |
| `npm run build`（型チェック＋esbuild 本番） | ✅ `main.js` 生成成功（113,644 bytes） |
| CI（PR #133・GitHub Actions） | ✅ app-test / test-required / design-doc / requirements-doc-check / ui-section-check / data-model-section-check / docs-site-schema-check / secret-scan すべて pass |

### 既定反転を固定する主な単体テスト（settings → 解決 → ViewModel）

- `settings.test.ts`: `DEFAULT_SETTINGS.completionProperty === "done"`／空オブジェクト・非文字列は既定 `done` へ／**明示的な空文字 `""` は尊重して無効維持（移行保護）**。
- `readAxis.test.ts`: `resolveCompletionId(null, DEFAULT_SETTINGS) === "note.done"`（初期有効）／明示空は `null`（opt-out）／軸衝突ガード継続。
- `toViewModel.test.ts`: 既定で `completionEnabled=true`・`done:true` に `completed`／明示空で機能オフ。

## 2. 実機 Obsidian 往復 E2E（`scripts/e2e/setup-and-run.sh`）

**本リリースでは再実行していない（当セッション環境に実機 Obsidian の実行手段が無いため）。**

判断根拠: 本 PATCH の挙動変更は設定既定値の 1 行フリップに限られ、対象シーム（`settings` → `resolveCompletionId` → `toViewModel` → `NoteCard` 描画条件）は上記単体テストで網羅されている。カードのドラッグ書き戻し・完了トグルのクリック/キー操作・undo などの**対話経路そのものは v0.2.1 から不変**で、往復契約（`registerBasesView` → `getValue` → `processFrontMatter` → `onDataUpdated`）にも変更はない。したがって新規の実機回帰面は「初期状態で完了ボタンが描画されるか」に限定され、これは単体（描画条件）＋ CI で担保される。

**推奨（リリース後スモークで実施）**: 実機 Obsidian で、完了プロパティ未設定の Base を開き、①各カードに完了ボタンが（hover/focus で）表示されること、②クリック/`x` で `done` が書き戻り再クエリで反映されること、③設定で完了プロパティを空にするとボタンが消えること、を目視確認する（`docs/test/release-v0.2.2-smoke.md` に記録）。

## 判定

自動スイート（454 passed）・型・Lint・ビルド・CI が緑、既定反転と移行保護（明示空の尊重）が単体テストで固定され、多角的レビュー（6/5/4 観点＋敵対的 2 重検証・R1→R4 で収束）で確定した指摘に対応済み。**PATCH `0.2.2` としてリリース可**。実機の目視確認はリリース後スモークで補完する。
