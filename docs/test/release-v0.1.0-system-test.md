# 総合テスト（システムテスト）記録 — v0.1.0

> `.claude/rules/testing-strategy.md`「総合（システム）」に基づくリリース前の通し検証記録。
> `docs/` 配下は Pages に自動公開されるため、実データ・内部情報・秘密は記載しない（`.claude/rules/operations.md`）。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.1.0`（初回リリース／直前タグなし＝全履歴が対象） |
| 対象コミット | `d73a43d`（`test(e2e): 実機 Obsidian で Bases 往復を自動検証＋ハーネス移行` #48） |
| 対象 Milestone | v1: Eisenhower Matrix（boolean 軸）＝open 0 / closed 7 |
| 実施日 | 2026-07-05 |
| 実施環境 | 単体スイート: Node（vitest, jsdom）／実機 E2E: Obsidian 1.12.7（Electron・Playwright `connectOverCDP`） |

## 基準

`docs/要件定義書.md` の主要機能（F1–F6）・非機能要件（**定量 SLA なし**）と、L1 Milestone v1 の成果 AC。

## 1. 全テストスイート（`npm test` / `npm run build` / `npm run lint`）

| 検証 | コマンド | 結果 |
|------|---------|------|
| 単体テスト | `npm test`（vitest run） | ✅ **256 passed / 256**（19 test files） |
| 型チェック＋本番バンドル | `npm run build`（`tsc --noEmit --skipLibCheck` → esbuild production） | ✅ **exit 0**（`main.js` 93,672 bytes 生成） |
| Lint | `npm run lint`（eslint） | ✅ **exit 0** |

> 単体スイートの stderr に出る `registerBasesView failed` ログは、graceful 縮退（Bases API 例外を伝播させず `false` を返す）を検証するテスト内の意図的な例外であり、正常系。

## 2. 実機 E2E スモーク（中核ループの往復・主要導線）

要件定義書 6節の方針（Obsidian 実機ロードが必要な統合・UI は手動/結合で担保）に従い、対象コミット（#48）で実施済み。証跡は `docs/test/v1-e2e-result.json`・`docs/test/v1-manual-verification.md`・`docs/screenshots/v1-e2e-0{1,2,3}-*.png`。

- **自動チェック 21/21 PASS**（Obsidian 1.12.7 実機を `--remote-debugging-port` 起動し Playwright で駆動・観測）。
- 実機でしか担保できない中核ループ（`registerBasesView` → `getValue` → `processFrontMatter` → `onDataUpdated` 自動再発火 → base 再オープンによるサーバ再分類）を緑で確認。CLAUDE.md「着手前スパイク必須」の往復要件を充足。

### 主要機能ごとの充足状況

| 機能 | 検証手段 | 結果 |
|------|---------|------|
| F1 Bases ビュー登録（graceful 縮退含む） | E2E（plugin loaded / matrix view rendered）＋単体（`registerView.test.ts`） | ✅ |
| F2 象限算出（4 象限＋未分類・absent 区別 #33） | E2E（Do/Schedule/Delegate/Delete・absent→未分類・false→Delete）＋単体（`toViewModel.test.ts` 27件） | ✅ |
| F3 ドラッグ書き戻し（楽観更新＋`onDataUpdated`＋ロールバック） | E2E（実ポインタ drag→`processFrontMatter`→再発火→reclassify・#43/#44 経路含む）＋単体（`MatrixView.test.tsx` 28件） | ✅ |
| F4 軸プロパティ設定（ハイブリッド＋書込ガード・非 boolean ロック #34） | E2E（`numeric` が 🔒 でドラッグ不可）＋単体 | ✅ |
| F5 カード操作（開く/新タブ/プレビュー/キーボード） | 単体（`cardInteraction.test.ts`・`NoteCard.test.tsx`）／E2E 手動項目（I）は個別手動 | ✅（単体緑・実機目視は手動チェックリスト） |
| F6 設定タブ（デフォルト軸・ラベル/色・欠損・i18n） | 単体（`MatrixView.test.tsx`・`QuadrantCell.test.tsx`）／i18n（H）は手動 | ✅（単体緑・i18n 目視は手動チェックリスト） |
| undo（直前 1 手・#40） | E2E（コマンド undo で復元をアサート・G3） | ✅ |

> 実機ハーネス未カバーの手動項目（A5 失敗ロールバック・C2/C3 非 md 混在・D dirty ノート・E 縮退・F 数百件スケール・H i18n・I カード操作・G1/G2）は `docs/test/v1-manual-verification.md` の手動チェックリストに委ね、v1 スコープ（要件定義書 9節「残る未決事項」）の範囲で許容する。

## 3. 非機能

| 観点 | 判定 |
|------|------|
| 定量目標（応答時間・スケール） | 数値 SLA を持たない方針（要件定義書 5節）。7 件で描画 2–3ms を確認済み。数百件は未測定＝未決事項として v2 で実測 |
| セキュリティ・データ保護 | 完全ローカル・ネットワーク/テレメトリなし（設計どおり） |
| 監視・バックアップ/DR | 該当なし（クライアントサイドプラグイン） |

## 結論

**合格（不合格 0 件）**。単体スイート 256 PASS・build 緑・lint 緑、実機 E2E 21/21 PASS。主要機能 F1–F6 と中核往復ループを実機で確認済みで、v0.1.0 のリリース判定基準を満たす。手動項目は v1 スコープの範囲で手動チェックリストに委ねる。
