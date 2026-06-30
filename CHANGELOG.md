# Changelog

このプロジェクトの注目すべき変更を記録する。書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従い、バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

### Added

- Bases カスタムビュー「Eisenhower Matrix」の登録（アダプタ層）。Bases が無効な環境では graceful に処理してプラグインの他機能を壊さない。ビューはローディング・空・初期状態のシェルを表示する（4 象限の配置は今後のリリースで追加）。(#18)
- 各ノートの緊急度・重要度（boolean 軸）を読んで 2×2 マトリクス（Do/Schedule/Delegate/Delete）＋未分類ゾーンへ自動配置。軸プロパティが未設定（absent）のノートは `false` と区別して未分類ゾーンに表示する。テーマ追従・レスポンシブ・各象限の空状態表示に対応。(#19)
