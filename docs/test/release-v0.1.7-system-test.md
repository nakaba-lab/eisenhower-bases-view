# 総合テスト（システムテスト）記録 — v0.1.7

> `.claude/rules/testing-strategy.md`「総合（システム）」に基づくリリース前の通し検証記録。
> `docs/` 配下は Pages に自動公開されるため、実データ・内部情報・秘密は記載しない（`.claude/rules/operations.md`）。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.1.7`（暫定。直前タグ `0.1.6` 以降の `develop` 差分。「リリースノート確定」で確定） |
| 対象コミット | `5bfc4af`（`fix(review): 多角的レビューの確定指摘に対応（堅牢化・a11y・データ破壊防止） (#81)`。ほかに `6038d6d` `chore(lint): eslint-plugin-obsidianmd 提出前 bot 検証導入 (#80)`） |
| 対象 Milestone | 運用なし（本リリースはレビュー駆動の堅牢化 fix ＋ lint tooling の chore。open issue 0） |
| 実施日 | 2026-07-06 |
| 実施環境 | 単体スイート: Node（vitest, jsdom）／実機 E2E: Obsidian 実機（本セッション環境には Obsidian ランタイム/GUI が無いため下記「2. 実機 Obsidian 往復 E2E」参照） |

## 基準

`docs/要件定義書.md` の主要機能（F1–F6）・非機能要件（**定量 SLA なし**）と、L1 Milestone v1 の成果 AC。本リリースの主眼は多角的レビューで確定した堅牢性・アクセシビリティ・データ破壊防止の是正で、既存機能の回帰が無いことを併せて確認する。

## 本リリースの変更概要（回帰面）

- Bases 接触点（`getValue`／`getAsPropertyId`）の例外境界防御（try/catch 退避）。書き戻し可能軸で型を確証できない場合は安全側でロック（ドラッグ不可）にして非 boolean 値の上書き破壊を防止。
- 楽観オーバーレイのライフサイクル修正: 成功確定時の再突合（居残り解消）・アンマウント後 settle ガード・コマンド undo のビュー横断オーバーレイ落とし。
- アクセシビリティ: 移動成功の aria-live 読み上げに undo 導線（コマンド）案内を追加。
- 保守性: settle の副作用分岐を純関数 `planSettle` に抽出。テスト強化（例外退避・lock-on-throw・空リスナー retarget・liveStatus 初回契約・undo 戻り値・registerPendingDropper 登録/解除）。フレーキーな 500 件の実時間アサーションを分類正しさの固定へ置換。
- いずれも**追加的な防御・a11y 強化**で、実機で検証済みの往復契約（`registerBasesView` → `getValue` → 実ポインタドラッグ → `processFrontMatter` → `onDataUpdated` → undo）の正常系の挙動は変えない。

## 1. 全テストスイート（`npm test` / `typecheck` / `lint` / `build`）

対象コミット `5bfc4af`（`git checkout develop` 後、`npm ci` でクリーン依存）で実行。

| 項目 | 結果 |
|------|------|
| `npm test`（vitest） | ✅ **273 passed**（19 files。前リリース 262 → +11。例外退避・lock-on-throw・planSettle・registerPendingDropper 等の新規/是正テストを含む） |
| `npm run typecheck`（`tsc --noEmit`） | ✅ エラーなし |
| `npm run lint`（eslint） | ✅ **0 errors**（既存の意図的 warning 1 件のみ＝decoupled 層の標準 DOM 使用〔`obsidianmd/prefer-create-el`〕。挙動に影響なし） |
| `npm run build`（型チェック＋esbuild 本番） | ✅ `main.js` 生成成功（95,737 bytes） |

## 2. 実機 Obsidian 往復 E2E（`scripts/e2e/setup-and-run.sh`）

**本リリースでは実施しない（メンテナ判断で該当なし）。** 本セッションの実行環境には Obsidian ランタイム/GUI が無いことに加え、本リリースの変更は**例外境界防御（try/catch 退避）・アクセシビリティ・楽観状態のライフサイクル是正**に限られ、実機で検証済み（v0.1.6 で 21/21 checks passed）の往復契約〔`registerBasesView` → `getValue` → 実ポインタドラッグ → `processFrontMatter` → `onDataUpdated` → undo〕の**正常系ロジックは変更していない**。追加した防御・是正はいずれも単体テストで網羅済み（例外退避・lock-on-throw・planSettle・registerPendingDropper 登録/解除・undo 戻り値ほか。§1 の 273 pass）。ゆえに PATCH リリースとして実機 E2E は該当なしと判断した（メンテナ承認済み・2026-07-06）。

## 3. 性能

`docs/要件定義書.md` の非機能要件は**定量 SLA なし**。本リリースは描画・計算量に実質変化なし（例外パスの try/catch と純関数抽出のみ）。大量入力の分類正しさは `toViewModel` の 500 件テスト（各象限 125 件を漏れなく分類）で固定済み＝定量性能テストは**該当なし**。

## 総括

自動スイート（273 pass）・typecheck・lint（0 error）・本番ビルドはすべて合格し、既存機能の回帰は自動テスト範囲で検出されなかった。実機 Obsidian 往復 E2E は、本リリースが防御・a11y 中心で単体テスト網羅済みであることからメンテナ判断で該当なしとした（§2）。**リリース可**（版番号の確定は「リリースノート確定」で行う）。
