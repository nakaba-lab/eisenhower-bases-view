---
title: v1 リリース前 実機手動検証チェックリスト
description: Obsidian 実機でのみ確認できる項目（dirty ノート挙動・graceful degradation・数百件スケール・往復スモーク）のリリース前チェックリスト
---

# v1 リリース前 実機手動検証チェックリスト

単体テスト（`npm test`）で担保できない、**Obsidian 実機ロードが必要な項目**をリリース前に確認する記録。要件定義書 §6「テスト方針」の総合（システム）テスト＝実機スモーク、および §9「未決事項」の実機確認項目に対応する。

> このファイルは**テンプレート兼記録**。実施時に「対象」を埋め、各行の合否（✅/❌/—）と備考（証跡・スクショのパス）を記入する。`docs/` 配下は Pages に自動公開されるため、**実データ・内部情報・秘密は書かない**（`.claude/rules/operations.md`）。

## 対象

| 項目 | 値 |
|------|----|
| 実施日 | 2026-07-05 |
| 対象バージョン | 0.1.0（`manifest.json`） |
| 対象コミット | `9027392` |
| Obsidian バージョン | 1.12.7（`minAppVersion` 1.12.0 以上） |
| OS | Linux（WSL2 + WSLg・`DISPLAY=:0`） |
| 実施者 | Claude Code（自動 E2E ハーネス `scripts/e2e/` ＝ CDP 駆動・無人） |

> **実施方式**: `scripts/e2e/setup-and-run.sh`（本実装へ移行済み）で実機 Obsidian 1.12.7 を `--remote-debugging-port` 起動し、Playwright `connectOverCDP` でレンダラを駆動・観測した（**15/15 自動チェック PASS**）。証跡は `docs/screenshots/v1-e2e-0{1,2,3}-*.png` と `docs/test/v1-e2e-result.json`。**A の中核ループ（Bases API 往復）・B（absent 区別）・C1・非 boolean ロック・G3（コマンド undo）**を自動で緑にした。**A5・C2/C3・D・E・F・H・I・G1/G2 は自動ハーネス未カバー**（要手動確認・下表の各行に明記）。

### 準備（テスト Vault）

1. `npm run build` で `main.js` を生成し、`main.js` / `manifest.json` / `styles.css` をテスト Vault の `<Vault>/.obsidian/plugins/eisenhower-bases-view/` に配置する。
2. コミュニティプラグインとして有効化する。
3. `.base` を 1 つ作り、`note.urgent` / `note.important`（boolean）を持つノートを数件用意する（象限確認用に true/true・false/true・true/false・false/false・absent を各 1 件以上）。

---

## A. 往復スモーク（中核ループ：分類→書き戻し→再配置）

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| A1 | `.base` を開き Configure view で Eisenhower Matrix を選ぶ | 2×2 グリッド＋（表示設定時）未分類ゾーンが描画される | ✅ | `type: eisenhower-matrix` の base 直接オープンで描画（01-initial.png）。`registerBasesView` 登録後に描画される往復を確認 |
| A2 | 各ノートが両軸値どおりの象限に並ぶ | true/true=Do・false/true=Schedule・true/false=Delegate・false/false=Delete | ✅ | Do=[do, infolder]・Schedule=[schedule]・Delegate=[delegate]・Delete=[delete]（01-initial.png・result.json） |
| A3 | カードを別象限へドラッグ | 楽観的に即移動→対象ノートの frontmatter の両軸が `true/false` に書き変わる | ✅ | 実ポインタドラッグ schedule→Do で `schedule.md` が `urgent:true/important:true` へ（`processFrontMatter`。02-after-writeback.png） |
| A4 | 書き戻し後 `onDataUpdated` で再クエリ→再配置 | 手動再描画なしで新象限に落ち着く（ちらつき・二重表示なし） | ✅ | `onDataUpdated` 自動再発火を計測（count=1）・schedule カードが Do へ再配置（手動再描画なし） |
| A5 | 書き込みを失敗させる（例: 読み取り専用にする 等） | 楽観移動がロールバックし Notice が出る（frontmatter は壊れない） | — | 自動ハーネス未カバー（要手動：読み取り専用/権限エラーの惹起） |

## B. absent / false / true の区別（#33 回帰）

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| B1 | 軸プロパティ未設定（absent）のノート | 未分類ゾーンに入る（Delete 象限に落ちない） | ✅ | `absent.md`（両軸なし）が未分類ゾーンに配置・ドラッグ可（Delete に落ちない） |
| B2 | 片軸のみ absent（もう片方は false） | 未分類（false と混同しない） | ✅ | `partial.md`（urgent のみ present・important absent）が未分類（片軸 absent で未分類化を確認。※もう片方=false ケースは要手動で追補推奨） |
| B3 | 両軸 false のノート | Delete 象限に入る | ✅ | `delete.md`（false/false）が Delete 象限に配置 |

## C. 非 Markdown の除外（`.base` 自己エントリ・今回の変更）

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| C1 | フィルタ無しの `.base`（Base 自身がエントリに含まれうる状態）で開く | `.base` ファイルがカード（未分類含む）として**現れない** | ✅ | `Eisenhower.base` はカード化されず（8 件の md ノートのみ配置。`file.ext=="md"` フィルタ＋`isPlaceableNote` の二重で除外） |
| C2 | Base に `.canvas` や画像が含まれる場合 | それらもカード化されない（md ノートのみ配置） | — | 自動ハーネス未カバー（要手動：`.canvas`/画像を含む Vault で確認） |
| C3 | md ノートが 1 件も無い Base | 空状態のプレースホルダが出る（クラッシュしない） | — | 自動ハーネス未カバー（要手動） |

## D. dirty ノート（開いている/未保存）への `processFrontMatter`（§9 未決）

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| D1 | 対象ノートをエディタで**開いた状態**でそのカードをドラッグ | 書き戻しが成功し、開いているエディタの frontmatter にも反映される | | |
| D2 | 対象ノートに**未保存の編集**がある状態でドラッグ | 編集内容が失われない／衝突しない（標準 API の挙動を確認・所見を残す） | | |
| D3 | ドラッグ直後にそのノートで Ctrl+Z | プラグインの undo とは独立に動く（README の非統合方針どおり） | | |

## E. graceful degradation（Bases 無効環境・§9 未決）

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| E1 | Bases コアプラグインを無効化した Vault で本プラグインを有効化 | 例外でクラッシュせず、`registerBasesView=false` を graceful 処理（他機能・設定ロードが壊れない） | | |
| E2 | コンソール（開発者ツール） | 致命的な未処理例外が出ない（log/Notice に留まる） | | |

## F. 数百件スケール（描画・ドラッグのジャンク・§9 未決）

> 純パイプライン（`toViewModel`）の線形性は単体テスト（`toViewModel.test.ts` の 500 件ケース）で回帰ガード済み。ここでは**実機の描画・ドラッグ体感**を確認する（jsdom はレイアウトしないため実測できない領域）。

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| F1 | 数百件（例: 300〜500）のノートを持つ Base を開く | 初期描画が体感で待たされない | | 計測値: `<ms>` |
| F2 | その状態でカードをドラッグ | ドラッグが滑らか（明確なジャンクが出ない） | | |
| F3 | DevTools Performance でトレース（任意） | 長い long task／過剰な再描画が無い | | トレース保存先: `<path>` |

> ジャンクが出た場合のみ、要件 §9 の方針どおり仮想化（`@tanstack/virtual` 等）の導入を検討する（実測前に入れない）。

## G. undo（直前 1 手・#40）

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| G1 | カードを分類し直した直後、ビュー内「元に戻す」トーストを押す | 1 手戻る（元の象限へ・frontmatter も復元） | 〜 | トースト「Moved "schedule" to Do.」＋Undo/× ボタンが実機で表示されるのを確認（02-after-writeback.png）。**ボタン click 自体の自動化は未実施**（G3 のコマンド経路で undo 復元は確認済み） |
| G2 | 元が未分類だったカードを分類後に undo | 軸プロパティが delete され未分類へ完全復元 | — | 自動ハーネス未カバー（要手動：absent カードを分類→undo で delete 復元） |
| G3 | コマンド「Eisenhower Matrix: 直前の移動を元に戻す」（ホットキー割当） | トーストと同じ 1 手 undo が起動 | ✅ | `executeCommandById("eisenhower-bases-view:undo-last-move")` で `schedule.md` が `urgent:false/important:true`（元）へ復元（03-after-undo.png） |

> **非 boolean 軸カードのロック（#34・データ破壊防止）も実機確認**: `numeric.md`（`urgent: 3`）が未分類ゾーンに 🔒 付きで表示され `aria-roledescription=draggable` を持たない＝**ドラッグ不可**（01-initial.png）。ロックカードのタイトルは `--text-muted` で可読（コントラスト修正の反映）。

## H. i18n（Auto / 英 / 日・F6）

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| H1 | 表示言語 Auto ＋ Obsidian を日本語 | UI 文言・既定象限ラベルが日本語 | | |
| H2 | 表示言語 Auto ＋ Obsidian を英語 | 英語に切り替わる | | |
| H3 | 表示言語を明示 en / ja に固定 | Obsidian 言語に関わらず固定される | | |

## I. カード操作（開く/新タブ/プレビュー/キーボード・F5）

| # | 手順 | 期待結果 | 合否 | 備考 |
|---|------|---------|------|------|
| I1 | カードをクリック（または Enter） | 現在タブでノートが開く | | |
| I2 | Cmd(mac)/Ctrl(win)+クリック（または Enter） | 新しいタブで開く | | |
| I3 | カードにホバー | コア「ページプレビュー」設定に従いプレビューが出る | | |
| I4 | Tab でカードにフォーカス→Space で掴む→矢印で移動→Space でドロップ | キーボードのみで分類できる（フォーカスリング可視） | | |

---

## 結果サマリ

| 区分 | 合 | 否 | 未実施 | 所見 |
|------|----|----|-------|------|
| A 往復スモーク | 4 | 0 | 1 | A1–A4 自動 PASS（中核ループ＝Bases API 往復・書き戻し・onDataUpdated 再発火）。A5（失敗ロールバック）は手動 |
| B absent 区別 | 3 | 0 | 0 | B1–B3 自動 PASS（absent/片軸absent/両軸false の区別。B2 の「もう片方=false」変種は手動で追補推奨） |
| C 非 md 除外 | 1 | 0 | 2 | C1 自動 PASS（`.base` 自己エントリ非表示）。C2/C3 は手動 |
| D dirty ノート | 0 | 0 | 3 | 未実施（開いているノート/未保存編集/Ctrl+Z 独立性は手動） |
| E graceful | 0 | 0 | 2 | 未実施（Bases 無効環境は別 Vault で手動） |
| F 数百件スケール | 0 | 0 | 3 | 未実施（体感性能は手動。純パイプラインの線形性は単体テストで担保済み） |
| G undo | 1 | 0 | 2 | G3（コマンド undo）自動 PASS。G1 はトースト表示のみ確認・click 未自動化、G2 は手動 |
| H i18n | 0 | 0 | 3 | 未実施（言語切替は手動。既定 en での描画は確認済み） |
| I カード操作 | 0 | 0 | 4 | 未実施（開く/新タブ/プレビュー/キーボード操作は手動） |
| （追加）非 boolean ロック #34 | 1 | 0 | 0 | `numeric` が 🔒 でドラッグ不可（データ破壊防止）を自動 PASS |

**総括**: 実機でしか確認できない**中核（Bases カスタムビュー往復＝`registerBasesView`→`getValue`→`processFrontMatter`→`onDataUpdated` 自動再発火）を実機 Obsidian 1.12.7 で自動検証し 15/15 PASS**。CLAUDE.md「着手前スパイク必須」で要求された往復（従来 jsdom では担保不能・#43/#44 のドラッグ経路含む）を実機で確定した。残る手動項目（A5・C2/C3・D・E・F・H・I・G1/G2）はリリース判定前に手動チェックリストで補完する。

### 未決事項への反映

実施後、要件定義書 §9「未決事項」の該当行（性能/仮想化・dirty ノート挙動・graceful degradation）を、確認結果に応じて解消（本文改訂＋「変更履歴」追記）するか、仮置きを更新する。
