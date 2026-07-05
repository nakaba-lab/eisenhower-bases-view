---
title: 設計書
description: 生きた設計書（docs/design/）の索引
---

# 設計書（索引）

「いま実装がどうなっているか（最新の設計・構造）」を表す生きた文書群。実装が変わるたびに上書き更新する。規律は `.claude/rules/design-doc.md`、frontmatter スキーマの真実源は `docs-site/src/content.config.ts`。

## 領域一覧

| 領域 | ファイル | 概要 | 状態 |
|------|---------|------|------|
| アーキテクチャ | [architecture.md](./architecture.md) | システム全体構成（三層構成・データフロー・主要設計判断） | active |
| Bases アダプタ層 | [bases.md](./bases.md) | Bases API 接触面の隔離・アダプタ↔UI 境界契約（ViewModel）（kind:api） | active |
| UI | [ui.md](./ui.md) | 画面構成・状態設計・ワイヤーフレーム・a11y（kind:ui） | active |

> 領域ファイルの追加・削除時のみこの索引を更新する。最終更新: 2026-06-30

## 各領域ファイルの構成（雛形）

各領域ファイルは先頭に必須 frontmatter を持つ（索引 `README.md` 自体は検証対象外）:

```markdown
---
title: <領域名> 設計
area: <領域キー>            # 例: architecture / ui / data-model
status: active             # active | deprecated | draft
relatedIssues: []         # 関連 Issue 番号（無ければ []）
updated: 2026-06-28
kind: architecture        # 任意: ui | api | data | architecture | operations | other
---
```

本文の節テンプレート（詳細は `.claude/rules/design-doc.md`）:

- 責務（このユニットは何をするか）
- 構成要素（主要コンポーネント／モジュール。Mermaid classDiagram／flowchart）
- データフロー・主要シーケンス（Mermaid sequenceDiagram）
- 外部依存・インターフェース
- 主要な設計判断（現行の理由）
- UI/画面設計（web/フロント領域のみ・必須。`kind: ui`）
