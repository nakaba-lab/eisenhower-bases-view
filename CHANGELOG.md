# Changelog

このプロジェクトの注目すべき変更を記録する。書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従い、バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

## [Unreleased]

### Added

- Bases カスタムビュー「Eisenhower Matrix」の登録（アダプタ層）。Bases が無効な環境では graceful に処理してプラグインの他機能を壊さない。ビューはローディング・空・初期状態のシェルを表示する（4 象限の配置は今後のリリースで追加）。(#18)
