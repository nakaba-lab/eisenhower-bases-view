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

- `console.log` — レンダラの console＋各チェックの PASS/FAIL ログ
- `result.json` — 構造化結果（`checks[]`／`dom`／`writeBack`／`reclassify`／`undo`）
- `01-initial.png` — 初期描画（4 象限＋未分類・ロックカード）
- `02-after-writeback.png` — ドラッグ書き戻し後（移動＋Undo トースト）
- `03-after-undo.png` — undo 後
- `matrix.png` — ビュー未描画で失敗したときのスクショ／`99-fatal.png` — 例外（FATAL）時のスクショ

> `$WORK`（既定は `mktemp` の一時ディレクトリ）は Obsidian 展開＋Vault で数百MB規模になるが**自動削除しない**。不要になったら手動で削除する。

## 環境変数

| 変数 | 既定 | 説明 |
|------|------|------|
| `OBS_VERSION` | `1.12.7` | 取得する Obsidian バージョン |
| `PLUGIN_MAIN` | `<repo>/main.js` | 検証対象プラグインの `main.js`（`manifest.json`/`styles.css` も同階層から拾う） |
| `VIEW_TYPE` | `eisenhower-spike` | テスト Vault の `.base` が使うビュー型 ID |
| `WORK` | 一時ディレクトリ | 作業（Obsidian 展開・Vault・出力）の置き場 |
| `CDP_PORT` | `9222` | Obsidian のリモートデバッグポート |

## 本実装（F1〜F6）への移行（完了済み）

スパイク版（`.eisenhower-spike` セレクタ・`eisenhower-spike` ビュー型・移動ボタン）から本実装へ**移行済み**。
現行ハーネスは次を検証する（`run-cdp.js`）:

1. `setup-and-run.sh` のテスト Vault `.base` は `type: eisenhower-matrix`（既定 `VIEW_TYPE`）。フィクスチャは
   4 象限＋未分類（absent/partial）＋非 boolean（numeric＝locked）＋フォルダ配下（Project/infolder）を網羅。
2. `run-cdp.js` は本実装セレクタ（`.eisenhower-matrix` / `.eisenhower-quadrant` / `.eisenhower-note-card`）で
   配置・ロックを確認し、**dnd-kit の実ポインタドラッグ**で書き戻し → `processFrontMatter`（ファイル反映）→
   `onDataUpdated` 自動再発火（`plugin.liveViews` のインスタンス計測）→ **base を開き直した楽観保留なしの
   新規描画でサーバ再分類**（往復後半）→ **undo コマンド**（前提と成否をアサートしてから遷移復元）を検証する。
   初回オープンの信頼ダイアログ（restricted mode）は `plugins.setEnable(true)`＋`enablePlugin` で解除する。

## スパイクで確定した API（参考）

`docs/要件定義書.md`「9. 未決事項 → スパイクで確定した事項」を参照。要点:

- `BasesViewFactory = (controller: QueryController, containerEl: HTMLElement) => BasesView`
- `entry.getValue(propertyId): Value | null`、`BasesEntry.file: TFile`、軸は `note.<name>`
- **absent は `getValue(...) instanceof NullValue` で判定**（NullValue は singleton・`false` と `isTruthy()` では区別不可）。※ #16 スパイク当時は `toString()===null` と観測したが、#33 の実機再検証で `NullValue.toString()` は型契約どおり**文字列 `"null"`** を返すと判明し是正した（型同一性へ。詳細は `docs/design/bases.md`「主要な設計判断」）
- `processFrontMatter` 書き戻し後 `onDataUpdated` は**自動再発火**（手動再描画不要）
- `minAppVersion` 1.12.0
