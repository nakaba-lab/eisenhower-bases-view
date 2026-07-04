# Eisenhower Matrix（Obsidian Bases カスタムビュー）

Obsidian の Bases（コアのデータベース機能）の**カスタムビュー**として、緊急度×重要度の 2×2 Eisenhower マトリクスを提供するプラグイン。ノートを 4 象限に配置し、カードのドラッグで frontmatter プロパティを書き戻して分類を永続化する。

- 既存の Bases ビュー（テーブル/カード/カンバン）ではできない「緊急×重要」の 2 軸俯瞰と、その場での再分類（永続化）を実現する。
- 書き戻しは標準の `app.fileManager.processFrontMatter` を用い、完全ローカル動作（ネットワーク通信・テレメトリなし）。
- 直前の移動を取り消せる: カードを分類し直した直後に出る「元に戻す」トースト、またはコマンド **「Eisenhower Matrix: 直前の移動を元に戻す」**（設定 → ホットキーで任意のキーを割り当て可能）で 1 手戻せる。**これは Obsidian 標準の取り消し（Ctrl+Z）とは統合していない独立した専用コマンド**で、保持するのは直前の 1 手のみ。元が未分類だったカードは軸プロパティを削除して未分類へ戻す。

> プラグイン id: `eisenhower-bases-view` ／ name: `Eisenhower Matrix` ／ `minAppVersion` 1.12.0（スパイク #16 の実機検証〔1.12.7〕で確定）／ `isDesktopOnly: true`（タッチ DnD は将来）。

## セットアップ

```bash
npm install
```

## 開発コマンド

| 目的 | コマンド |
|------|---------|
| ビルド（型チェック＋esbuild 本番バンドル → `main.js`） | `npm run build` |
| 開発（esbuild watch） | `npm run dev` |
| 型チェックのみ | `npm run typecheck` |
| テスト | `npm test` |
| Lint | `npm run lint` |
| フォーマット | `npm run format` |

## Obsidian での動作確認

ビルド成果物（`main.js` / `manifest.json` / `styles.css`）を、対象 Vault の `<Vault>/.obsidian/plugins/eisenhower-bases-view/` に配置し、Obsidian の設定でコミュニティプラグインとして有効化する（`main.js` はリポジトリには含めず GitHub release に添付する）。

## 開発ワークフロー

Issue 駆動 + Git Flow + git worktree + TDD（Red-Green-Refactor）+ Spec 駆動 + 多段コードレビューを採用する。詳細は `CLAUDE.md` と `.claude/rules/` を参照。要件は `docs/要件定義書.md`、設計は `docs/design/` を真実源とする。

## 前提

- Claude Code CLI
- フックの実行に `python3`
- GitHub 連携に `gh`（GitHub CLI）
- 動作確認に Obsidian デスクトップ（1.12.0 以上）

---

> このプロジェクトは Claude Code エージェント開発ワークフロー・テンプレート v1.9.0 から生成。
