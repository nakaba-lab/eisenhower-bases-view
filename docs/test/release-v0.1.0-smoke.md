# リリース後スモーク & ドキュメント最終確認 — v0.1.0

> `/release-tasks` の「リリース後スモーク」「マニュアル・ドキュメント最終確認」タスクの記録。
> `docs/` 配下は Pages 公開のため、実データ・内部情報・秘密は記載しない（`.claude/rules/operations.md`）。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.1.0`（初回リリース） |
| タグ | `0.1.0`（`aee402a`＝main の Merge Commit・`v` 接頭辞なし） |
| main 反映 | PR #56（Merge Commit `aee402a`） |
| develop 戻しマージ | PR #57（Merge Commit `e716e36`） |
| 実施日 | 2026-07-05 |

## 1. リリース後スモーク（リリース資産）

サーバデプロイは無し（`commands.deploy` 空）。タグ push 起点の `release.yml` によるリリース資産生成をスモーク対象とする。

| 検証 | 結果 |
|------|------|
| `release.yml` 実行 | ✅ completed / success（16s・タグ `0.1.0` 起動） |
| タグ=manifest version 検証（workflow 内） | ✅ 通過（`0.1.0` = manifest `0.1.0`） |
| GitHub Release `0.1.0` 公開 | ✅ published（draft=false・prerelease=false） |
| **添付資産 3 点** | ✅ `main.js` / `manifest.json` / `styles.css` |
| Release URL | https://github.com/nakaba-lab/eisenhower-bases-view/releases/tag/0.1.0 |

> リリース資産（`main.js`/`manifest.json`/`styles.css`）は、対象 Vault の `<Vault>/.obsidian/plugins/eisenhower-bases-view/` に配置してコミュニティプラグインとして有効化することでインストールできる（README「Obsidian での動作確認」）。中核導線の実機往復は総合テスト（`release-v0.1.0-system-test.md`・実機 E2E 21/21 PASS）で担保済み。

## 2. マニュアル・ドキュメント最終確認

| 項目 | 判定 |
|------|------|
| README（インストール・desktop-only・概要） | ✅ 最低基準を満たす（`isDesktopOnly: true`・`minAppVersion` 1.12.0・資産配置手順を明記） |
| 操作マニュアル・運用ガイド | — 要件定義書 6節により納品物マニュアルは不要（個人/コミュニティ向け・README が実質のマニュアル） |
| docs サイト（Pages） | ✅ Deploy Docs (Pages) CI success（develop `e716e36`・46s） |

### 改善候補（リリースブロッカーではない）

- README のエンドユーザー向け操作手順（`.base` でビュー選択 → 緊急度/重要度軸の設定 → カードのドラッグ分類 → undo）の拡充。コミュニティプラグイン公開の質を上げるため、post-release で Issue 化を検討する。

## 結論

**リリース後スモーク・ドキュメント最終確認とも合格**。GitHub Release `0.1.0` が 3 資産付きで公開され、README・docs サイトも健全。v0.1.0 リリース工程を完了とする。
