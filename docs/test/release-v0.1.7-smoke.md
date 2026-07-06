# リリース後スモーク記録 — v0.1.7

> `.claude/rules/testing-strategy.md`／`/release-tasks`「リリース後スモーク」に基づく、リリース直後の疎通確認記録。
> 本プロジェクトはサーバデプロイなし（`commands.deploy` 空）＝リリース実体はタグ push による GitHub Release 資産生成。
> よってスモークは「Release が生成され、Obsidian が読む資産 3 点が添付されたか」の確認に読み替える。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.1.7` |
| タグ | `0.1.7`（生バージョン・`v` なし＝Obsidian 例外。`manifest.json` の version と一致） |
| main マージ | PR #82（Merge Commit `122f27e`） |
| 実施日 | 2026-07-06 |

## 確認結果

| 項目 | 結果 |
|------|------|
| タグ push 起点の CI（Release Obsidian plugin＝`release.yml`） | ✅ `completed/success`（branch=`0.1.7`・run 28777927491） |
| GitHub Release `0.1.7` の公開 | ✅ 公開済み（draft=false・prerelease=false・github-actions[bot] 作成） |
| リリース資産（Obsidian が読む 3 点） | ✅ `main.js`（95,737 bytes）/ `manifest.json`（424 bytes）/ `styles.css`（11,569 bytes）すべて添付 |
| 資産の中身検証 | ✅ ダウンロードした `manifest.json` の `version` が `0.1.7`＝タグと完全一致（申請要件）。`main.js` は esbuild 本番バンドルで、リリース前総合テスト時のローカル本番ビルドとバイトサイズ一致（95,737） |
| ビルド由来検証（Artifact Attestations） | ✅ `gh attestation verify main.js --repo nakaba-lab/eisenhower-bases-view` 成功（exit 0） |
| サーバ疎通 | — no-op（サーバデプロイなし。`commands.deploy` 空・`release-deploy.yml` はサーバ用テンプレで本プラグインでは資産生成のみ＝`Release Deploy` run も success/8s） |

## 総括

タグ `0.1.7` の push により GitHub Release が公開され、Obsidian コミュニティプラグインのインストールに必要な資産 3 点が正しい中身（version 一致・provenance 検証済み）で添付されたことを確認した。サーバ疎通は該当なし（no-op）。リリース後スモーク合格。

> 実利用インストールの最終確認（BRAT 等での導入・実 Vault での動作）は、コミュニティプラグイン再レビュー／利用者の手元導入で担保する（本記録の範囲外）。
