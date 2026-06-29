# 実機 Obsidian E2E 検証ハーネス（Bases カスタムビュー往復）

実機の Obsidian デスクトップを **Playwright の CDP 接続**で無人起動・操作し、Bases カスタムビューの
往復ループ（`registerBasesView` 登録 → `entry.getValue` 読み取り → `app.fileManager.processFrontMatter`
書き戻し → `onDataUpdated` 自動再発火）を検証する。Issue #16（着手前スパイク）の自動検証で使用したもの。

> Obsidian は公式 headless モードを持たないが、`--remote-debugging-port` で CDP を開き
> `chromium.connectOverCDP` で接続すればレンダラ（`window.app`）を操作・観測できる。
> Playwright の `_electron.launch` は packaged Obsidian ではプロセス接続に失敗したため CDP 方式を採る。

## 前提

- Linux + GUI ディスプレイ（WSLg の `DISPLAY=:0`／X サーバ／Xvfb のいずれか）
- `node`・`curl`・インターネット（初回に Obsidian を DL）
- 検証対象プラグインがビルド済み（リポジトリルートで `npm run build` → `main.js`）

## 使い方

```bash
# リポジトリルートでプラグインをビルド
npm run build

# E2E 実行（Obsidian DL → テスト Vault 生成 → 起動 → 検証 → 後片付け）
scripts/e2e/setup-and-run.sh
```

出力（既定 `$WORK/out`、`WORK` 環境変数で変更可）:

- `console.log` — レンダラの console（各 entry の Value 表現・`onDataUpdated` 再発火回数 等）
- `spike.png` — 検証時点のスクリーンショット

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `OBS_VERSION` | `1.12.7` | 取得する Obsidian バージョン |
| `PLUGIN_MAIN` | `<repo>/main.js` | 検証対象プラグインの `main.js`（`manifest.json`/`styles.css` も同階層から拾う） |
| `VIEW_TYPE` | `eisenhower-spike` | テスト Vault の `.base` が使うビュー型 ID |
| `WORK` | 一時ディレクトリ | 作業（Obsidian 展開・Vault・出力）の置き場 |
| `CDP_PORT` | `9222` | Obsidian のリモートデバッグポート |

## 本実装（F1〜F6）への移行メモ

スパイク時点では `run-cdp.js` がスパイク専用ビュー（`.eisenhower-spike` セレクタ・`eisenhower-spike`
ビュー型・移動ボタン）を前提にしている。本実装のビュー（dnd-kit のドラッグ・別ビュー型 ID）に合わせて、
次の 2 箇所を更新する:

1. `setup-and-run.sh` のテスト Vault `.base` の `type:`（= `VIEW_TYPE`）
2. `run-cdp.js` の DOM セレクタ（`.eisenhower-spike*`）と操作（ボタン click → dnd-kit のドラッグ操作）

## スパイクで確定した API（参考）

`docs/要件定義書.md`「9. 未決事項 → スパイクで確定した事項」を参照。要点:

- `BasesViewFactory = (controller: QueryController, containerEl: HTMLElement) => BasesView`
- `entry.getValue(propertyId): Value | null`、`BasesEntry.file: TFile`、軸は `note.<name>`
- **absent は `getValue(...)?.toString() === null` で判定**（`false` と `isTruthy()` では区別不可）
- `processFrontMatter` 書き戻し後 `onDataUpdated` は**自動再発火**（手動再描画不要）
- `minAppVersion` 1.12.0
