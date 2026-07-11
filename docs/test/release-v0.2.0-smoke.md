# リリース後スモーク記録 — v0.2.0

> `.claude/rules/testing-strategy.md`／`/release-tasks`「リリース後スモーク」に基づく、リリース直後の疎通確認記録。
> 本プロジェクトはサーバデプロイなし（`commands.deploy` 空）＝リリース実体はタグ push による GitHub Release 資産生成。
> よってスモークは「Release が生成され、Obsidian が読む資産 3 点が添付され、provenance が検証できるか」の確認に読み替える。

## 対象

| 項目 | 内容 |
|------|------|
| バージョン | `0.2.0` |
| タグ | `0.2.0`（生バージョン・`v` なし＝Obsidian 例外。`manifest.json` の version と一致） |
| main マージ | PR #111（Merge Commit `74c73ae`） |
| develop 戻しマージ | PR #112（Merge Commit `29f4618`） |
| 実施日 | 2026-07-11 |

## 確認結果

| 項目 | 結果 |
|------|------|
| タグ push 起点の CI（Release Obsidian plugin＝`release.yml`） | ✅ `completed/success`（branch=`0.2.0`） |
| デプロイ雛形 CI（Release Deploy＝`release-deploy.yml`） | ✅ `completed/success`（branch=`0.2.0`） |
| GitHub Release `0.2.0` の生成 | ✅ 公開（`draft=false`・`prerelease=false`・name=`0.2.0`） |
| Obsidian が読む資産 3 点の添付 | ✅ `main.js`・`manifest.json`・`styles.css`（コミュニティプラグイン更新に必要な 3 点が揃う） |
| 資産の provenance（GitHub Artifact Attestations） | ✅ `gh attestation verify` が 3 点とも成功（`main.js` exit 0・`manifest.json`／`styles.css` verified）。ビルド由来を検証可能 |
| main マージの App Test（main ブランチ CI） | ✅ `success` |
| develop への版確定反映 | ✅ `manifest.json`=0.2.0・CHANGELOG `[0.2.0] - 2026-07-11`（次リリースの `[Unreleased]` 衝突を回避） |

## 総括

タグ `0.2.0` 起点の Release ワークフローが成功し、GitHub Release として Obsidian が読む資産 3 点（`main.js`/`manifest.json`/`styles.css`）が provenance 付きで公開された。疎通不能・資産欠落・attestation 検証失敗はいずれも無し。**リリース疎通 OK**。

> コミュニティプラグイン（`obsidian-releases`）側の反映は、利用者が Obsidian のプラグイン更新で `0.2.0` を取得できることで最終確認される（本記録の範囲は本リポジトリの Release 生成まで）。
