---
title: Bases アダプタ層 設計
area: bases
status: active
relatedIssues: [18, 19, 20, 21, 33]
updated: 2026-07-01
kind: api
---

# Bases アダプタ層 設計

> Issue #18（F1）・#19（F2）で実装した現状を反映。churn しやすい Bases API 接触面を本領域（`src/bases/`）に隔離する設計の真実源。API 事実は要件定義書「9. 未決事項」に接地する。**#20（F3）でドラッグ書き戻し（`MatrixCallbacks.onMoveCard` ＋ `processFrontMatter`）を実装し `status: active` に確定した。** **#33 で absent 判定を `toString()===null`（スパイク #16 の誤観測）から `instanceof NullValue`（型同一性）へ是正した（実機 `scripts/e2e` プローブで確定）。** **#21（F4）で軸プロパティ設定 UI（ビュー options＝主・プラグイン設定＝デフォルトのハイブリッド）を本領域に積み増した: `registerBasesView` の `options` に `note.*` のみ選択可の軸プロパティセレクタを 2 つ宣言し、選択時（`filter`）・読み取り時・書き戻し時の 3 面で「書き戻せる `note.*` 軸」を単一述語 `isWritableAxisProperty` で判定する。**

## 責務（このユニットは何をするか）

Obsidian Bases のカスタムビューとして Eisenhower マトリクスを登録し、Bases API（`registerBasesView`／`BasesView`／`QueryController`／`BasesEntry.getValue`／ビュー設定）への接触を 1 領域に集約する。各エントリを **Bases 非依存の ViewModel** に変換して UI（`src/ui`）へ渡し、UI・純ロジック（`src/logic`）が Bases 型へ直接依存しないようにする（疎結合化＝AC5）。

F1（#18）の範囲は **登録・graceful 失敗処理・描画経路・解除（リーク防止）・境界契約**まで。#19（F2）で**各エントリの軸値読み取り（absent 判定）と 4 象限＋未分類への事前グルーピング**を追加した（`readAxis.ts`／`toViewModel.ts`）。ドラッグ書き戻しは #20（F3）、軸プロパティ設定 UI は #21（F4）で本領域に積み増す。

## 構成要素（主要コンポーネント／モジュール）

```mermaid
flowchart TD
    main["src/main.ts<br/>onload: safeRegisterBasesView 経由で<br/>registerBasesView を呼び factory に EisenhowerBasesView を配線"]
    main -->|register コールバック注入| reg["src/bases/registerView.ts<br/>safeRegisterBasesView（false/例外を graceful 処理）＋VIEW_ID/NAME/ICON"]
    main -->|factory| view["src/bases/EisenhowerBasesView.ts<br/>BasesView サブクラス"]
    view -->|onDataUpdated| map["src/bases/toViewModel.ts<br/>entries → MatrixViewModel 変換"]
    map --> vm["MatrixViewModel（Bases 非依存の plain データ）"]
    view -->|render(container, vm, callbacks)| ui["src/ui/MatrixView.tsx<br/>Preact render（F1: シェル＋状態表示）"]
    view -->|onunload で unmount| unmount["preact unmount + container クリア"]
    ui --> logic["src/logic/（classifyQuadrant 等・#19 で接続）"]
```

- **`src/bases/registerView.ts`** — ビュー定数（`VIEW_ID`/`VIEW_NAME`/`VIEW_ICON`）と **`safeRegisterBasesView(register, onUnavailable)`**。`register`（＝`plugin.registerBasesView(...)`）をコールバックで受け、戻り値 `false`（Bases 無効）や API 例外を `console`／`Notice` で握って `onload` を継続させる（AC2）。obsidian ランタイムに依存しない純ラッパなので単体テスト可能。実際の `registerBasesView` 呼び出しと factory 配線は `src/main.ts` が行う（手動/結合で担保）。
- **`src/bases/EisenhowerBasesView.ts`** — `BasesView` サブクラス。コンストラクタで loading シェルを描画し、`onDataUpdated()` で `data.data`（`BasesEntry[]`）から `toViewModel` で ViewModel を組み `MatrixView` の `render()` を呼ぶ（AC3）。`onunload()` で Preact ルートを `unmount` する（AC4）。`extends BasesView`＝obsidian ランタイム必須のため単体テスト対象外。
- **`src/bases/toViewModel.ts`** — `BasesEntry[]` を **`MatrixViewModel`** へ変換する純関数（`import type` のみで obsidian 非依存＝単体テスト可能）。entry の `id`（file.path）/`title`（file.basename）と state（empty/ready）に加え、#19 で各 entry の軸値を読み `classifyQuadrant` で **4 象限＋未分類に事前グルーピング**した `placements` を組む（`.base` 自己エントリ・軸欠損ノートは両軸 absent → 未分類に落ちるため特別なフィルタは持たない）。`config`（ビュー options）と設定を受け取り {@link resolveAxisPropertyIds} で軸 propertyId を解決する。
- **`src/bases/readAxis.ts`** — 軸プロパティの解決と軸値の正規化（#19・absent 判定は #33 で是正）。`resolveAxisPropertyIds(config, settings)` がビュー options（`config.getAsPropertyId`・主）→設定デフォルト（`note.<name>`）の順で両軸 propertyId を解決し、`readAxisValues(entry, ids)` が `entry.getValue` の `Value` を **absent（NullValue・`value instanceof NullValue`）/true/false** に正規化する。NullValue（値）を obsidian から import するため（実機は外部提供・esbuild external）、単体テストは vitest が obsidian の値 import を `src/test-support/obsidianStub.ts` へ解決する（型は `import type`）。**読み取り側も書き戻し可能な `note.*` のみを有効軸とし、`formula.*`／`file.*` が設定された軸は値があっても absent（undefined）扱いにして未分類へ落とす**（書き戻し側 `toFrontmatterKey` ガードと対称化＝「4 象限に並ぶのにドラッグすると必ず失敗するカード」を作らない）。**#21（F4）で「書き戻せる `note.*` 軸か」の判定を単一述語 `isWritableAxisProperty`（本ファイル＝`readAxis.ts` に配置）に集約し、`toFrontmatterKey` はこの述語を再利用する（options の `filter`・読み取り `readSingleAxis`・書き戻し `writeBackAxes` の 3 面が同一定義を共有＝軸許容ルールの二重管理を無くす）。述語を `readAxis.ts` に置くのは、`viewOptions.ts` が options キー（`URGENT_OPTION_KEY`/`IMPORTANT_OPTION_KEY`）と述語を `readAxis` から一方向 import できる形にし、`readAxis`↔`viewOptions` の循環依存を避けるため（`readAxis` が既に `NOTE_PROPERTY_PREFIX`・キー・`toFrontmatterKey` を持つ自然な置き場）。**
- **`src/bases/viewOptions.ts`（#21 F4）** — `registerBasesView` に渡す**軸プロパティセレクタ options の純ビルダー**。`buildAxisViewOptions(): BasesPropertyOption[]` は緊急度・重要度の 2 軸ぶんのビュー option 定義（`key`＝`URGENT_OPTION_KEY`/`IMPORTANT_OPTION_KEY`、`type: "property"`、`displayName`、`placeholder`、`filter: isWritableAxisProperty`）を返す。軸許容ルールの述語 `isWritableAxisProperty` とキーは `readAxis.ts` から import する（真実源は 1 つ・循環回避）。`extends BasesView` 本体・`main.ts` の登録呼び出しは obsidian ランタイム依存で単体対象外のため、テスト可能な純度（キー・型・`filter` 挙動）をこのビルダーへ逃がす（`registerView.ts` の `safeRegisterBasesView` と同じ「純ラッパを切り出す」流儀）。`main.ts` は `registerBasesView(VIEW_ID, { name, icon, factory, options: () => buildAxisViewOptions() })` で配線する（`options` は `(config) => BasesAllOptions[]` の関数形。本ビューの options は config 非依存のため config を無視する）。
- **`src/bases/types.ts`** — 境界 ViewModel 型（`MatrixViewModel`/`MatrixEntry`/`MatrixState`/`MatrixCallbacks`）。`src/ui` はこの型のみに依存し、`obsidian`/Bases 型を import しない（AC5。`MatrixCallbacks` は F1 では空で、F3/F5 で操作を足す）。

## データフロー・主要シーケンス

```mermaid
sequenceDiagram
    actor U as ユーザー
    participant M as src/main.ts
    participant R as safeRegisterBasesView（src/bases）
    participant B as Bases (QueryController)
    participant V as EisenhowerBasesView
    participant T as toViewModel
    participant UI as MatrixView (src/ui / Preact)

    M->>R: onload → safeRegisterBasesView(register, onUnavailable)
    R->>B: register() = plugin.registerBasesView(viewId, registration)
    alt Bases 有効
        B-->>R: true（Configure view に型が出る）
    else Bases 無効/例外
        B-->>R: false（onUnavailable で log/Notice・onload 継続）
    end
    U->>B: .base で Eisenhower Matrix を選択し開く
    B->>V: factory(controller, containerEl) → BasesView 生成
    B->>V: onDataUpdated()
    V->>T: data.entries / config を渡す
    T-->>V: MatrixViewModel（plain）
    V->>UI: render(containerEl, viewModel, callbacks)
    Note over V,UI: F1 は initial/loading/empty シェルを描画（4 象限配置は #19）
    U->>B: ビューを閉じる / onunload
    B->>V: ビュー破棄
    V->>UI: unmount(containerEl)（リーク防止＝AC4）
```

## 外部依存・インターフェース

- **Obsidian Plugin API**（スパイク #16 で実機確定。型は obsidian 1.13.x 型定義に存在）:
  - `Plugin.registerBasesView(viewId: string, registration): boolean`（`false`＝Bases 無効）
  - `BasesViewFactory = (controller: QueryController, containerEl: HTMLElement) => BasesView`
  - `BasesView`（抽象）: `config: BasesViewConfig`・`allProperties: BasesPropertyId[]`・`data: BasesQueryResult`・`abstract onDataUpdated()`
  - `BasesEntry.getValue(propertyId): Value | null`・`BasesEntry.file: TFile`（軸読み取りは #19）
- **境界 ViewModel 型（`src/bases/types.ts`・本契約が AC5 の核）** — `src/ui` はこの型にのみ依存する:
  ```ts
  // Bases 非依存。obsidian 型を一切含めない（file は TFile を直接出さず、
  // 開く操作に必要な情報＋コールバック経由でアダプタに委譲する）。
  export interface MatrixEntry {
    id: string;        // 安定キー（file.path 等）
    title: string;     // 表示名
    // urgent/important（boolean | undefined）は #19 で追加
  }
  export type MatrixState = "loading" | "empty" | "ready";
  export interface MatrixViewModel {
    state: MatrixState;
    entries: MatrixEntry[];   // F1 ではシェル表示用（配置は #19）
  }
  export interface MatrixCallbacks {
    // F3（#20）でドラッグ書き戻しを追加。F5（#22）でカードを開く導線を足す。
    // 書き戻しは両軸の boolean を渡すだけで、TFile 解決・processFrontMatter は
    // アダプタ（EisenhowerBasesView）が担う（UI は obsidian 型に触れない＝AC5）。
    onMoveCard?(entryId: string, axisValues: { urgent: boolean; important: boolean }): Promise<void>;
  }
  ```
- **UI 入口**: `render(containerEl: HTMLElement, viewModel: MatrixViewModel, callbacks: MatrixCallbacks): void`（Preact `render()` を内部で呼ぶ命令的橋渡し）。`unmount(containerEl)` で破棄。
- **書き戻し（#20 F3）**: `EisenhowerBasesView` が `onMoveCard` を実装し、`entryId`（file.path）→ `app.vault.getAbstractFileByPath` で `TFile` を解決、解決済み軸 propertyId（`note.<key>`）から frontmatter キー（`<key>`）を取り出し、`app.fileManager.processFrontMatter(file, fm => { fm[urgentKey] = urgent; fm[importantKey] = important; })` で**両軸を明示 `true/false`** 書き込みする（`delete` しない＝v1 boolean 軸）。読み取り（`getValue`）と書き込み（`processFrontMatter`）は別系統。`processFrontMatter` が reject したら UI 側がロールバック＋`Notice`（`ui.md` のシーケンス参照）。
- **ビルド**: esbuild（`main.js`）。`minAppVersion` 1.12.0・`isDesktopOnly: true`（確定）。

## 主要な設計判断（現行の理由）

- **境界契約は「ViewModel 変換」を採用（#18 設計オプション比較で選択）**: アダプタが各 `BasesEntry` を Bases 非依存の `MatrixViewModel`（plain データ）へ変換し、UI は単一の `render(container, viewModel, callbacks)` 入口だけを受ける。`src/ui`・`src/logic` に `obsidian`/Bases 型を一切漏らさず AC5 の疎結合を構造で保証し、変換ロジックを純度高くテストできる。
  - **却下: 生 entries＋アクセサ注入** — 変換コードは減るが `BasesEntry` 型が UI 近傍に漏れ、AC5「UI/logic は Bases 型に直接依存しない」を弱める。Bases API churn（1.12 で options 破壊的変更の実績）が UI まで波及する。
  - **却下: ハイブリッド（薄い橋＋遅延読取）** — 中間案だが「どこまでが Bases 依存か」の境界が曖昧になり、テスト時に Bases モックが UI 側へ侵食する。
- **`registerBasesView=false` を graceful 処理**: Bases 無効 Vault でも例外を投げず log/Notice に留め、設定ロード等の他機能を壊さない（AC2）。
- **解除は Preact `unmount` を明示**: ビュー破棄・`onunload` で Preact ルートを `unmount` し DOM/購読リークを防ぐ（AC4）。
- **F1 で境界型を先に確定**（`MatrixCallbacks` は空でも置く）: F2〜F5 が同じ境界に積み増せるよう、契約面を最初に固定して後続の手戻りを避ける。
- **手動再描画は持たない**: 書き戻し→`onDataUpdated` 自動再発火で反応ループが閉じる（スパイク #16 確定）。F1 は描画経路の確立まで。
- **書き戻しはアダプタに隔離（#20）**: `MatrixCallbacks.onMoveCard` は両軸の boolean だけを受け、`TFile` 解決・frontmatter キー算出・`app.fileManager.processFrontMatter` 実行をアダプタ（`EisenhowerBasesView`）が担う。UI・logic に `obsidian` 型を漏らさず（AC5 維持）、書き込み経路を読み取り経路（`getValue`）と同じく 1 領域へ集約する。frontmatter キーの取り出し（`note.urgent`→`urgent`）は純関数として切り出し単体テスト対象にする（`extends BasesView` 本体は obsidian ランタイム必須で対象外のため、テスト可能な純度をキー算出に逃がす）。
- **absent 判定は型同一性 `instanceof NullValue`（#33）**: 欠損プロパティの `getValue` は **NullValue（singleton）** を返す。これを `value instanceof NullValue` で検出し、明示 `false`（BooleanValue・`isTruthy()===false`）と区別する。
  - **却下: `toString()===null`（旧実装・スパイク #16 の誤観測）** — 実機の `NullValue.toString()` は型契約どおり**文字列 `"null"`** を返す（JS `null` ではない）ため判定が機能せず、absent が false に誤判定され欠損ノートが Delete 象限に落ちていた（`scripts/e2e` の getValue プローブで `toStringType:"string"`・`toString:"null"` を実測）。
  - **却下: `constructor.name === "NullValue"`** — 実機ランタイムは minify 済みで constructor 名は `"t"`（プローブで実測）。名前依存は壊れる。型同一性（instanceof）は prototype チェーンで成立し、minify・文字列表現に依存しない。
  - **テスト容易性の代償**: readAxis に obsidian の**値** import（`NullValue`）が入り「`import type` のみ」ではなくなる。vitest は obsidian の値 import を最小スタブ（`src/test-support/obsidianStub.ts`）へ alias して単体テスト可能性を保つ（型は本物の `obsidian.d.ts`）。実機での成立は `scripts/e2e` の placements 検証で担保（absent/partial が未分類へ入る）。
- **軸許容ルールは単一述語 `isWritableAxisProperty`（`readAxis.ts`）に集約（#21 F4）**: 「書き戻せる `note.*` 軸か」の判定を 1 つの純関数に集約し、**options の `filter`（選択時に弾く）・読み取り `readSingleAxis`（非 note.* 軸を未分類へ）・書き戻し `writeBackAxes`（Notice で弾く）の 3 面が同じ定義を共有**する。選択・読み取り・書き戻しでルールがずれると「選べるのに壊れる」「読めるのに書けない」非対称が生まれるため、churn 面（options 宣言）と実行面（読み書き）を 1 述語で対称化する。述語は `readAxis.ts`（`NOTE_PROPERTY_PREFIX`・option キー・`toFrontmatterKey` の置き場）に置き、`viewOptions.ts` が一方向 import する（`readAxis`↔`viewOptions` の循環依存を避ける＝実装時の設計ドラフトから調整した点）。
  - **却下: 各面で `startsWith("note.")` をインライン** — 記述は最小だが 3 箇所に散り、v2 で数値/タグ軸の許容ルールを足すとき同期漏れが起きる。
  - **却下: 述語を `viewOptions.ts` に置く（初期ドラフト案）** — `viewOptions` が `readAxis` のキーを import し、`readAxis` が `viewOptions` の述語を import する双方向依存（循環）になる。ESM live-binding で動きはするが code smell のため、依存を一方向（`viewOptions`→`readAxis`）に正した。
- **options 宣言は純ビルダー `buildAxisViewOptions()` に切り出す（#21 F4）**: `registerBasesView` の `options` 配列を `main.ts` にインラインせず純関数へ逃がし、`filter` 挙動・option キー（`config.getAsPropertyId` が読むキーと一致）・`type` を単体テストで固定する。`main.ts`／`extends BasesView` は obsidian ランタイム必須で単体対象外のため、テスト可能な純度をビルダーへ寄せる（`safeRegisterBasesView` と同じ設計判断の踏襲）。churn しやすい options 型は実装時に実機 `obsidian.d.ts`（1.13.x）に照合済み: `options?: (config: BasesViewConfig) => BasesAllOptions[]`（関数形）・`BasesPropertyOption`（`type:'property'`・`key`・`displayName`・`filter?: (prop: BasesPropertyId) => boolean`）。スパイクは読み取り `getAsPropertyId` のみ確定だったが、options 登録型は型定義で確定した（AC ヒント `filter: (prop) => prop.startsWith("note.")` と一致）。
- **AC1/AC4 の UI はすべて Bases ネイティブ（独自 Preact コンポーネントを持たない）（#21 F4）**: 軸選択 UI は Bases の Configure view が options 宣言から自動描画し、options 変更→`onDataUpdated` 自動再発火で再配置される（手動再描画なし）。書込不可軸のガードは既存 Notice を流用。ゆえに F4 は `src/ui` に差分を持たず、ビジュアル/UX 検証はロジック（filter/ガード/再解決）の単体テストと結合（実機 Configure view 操作）で担保する。

## UI/画面設計（F1 範囲＝シェル＋状態表示）

F1 が描画するのは Matrix ビューの **シェルと状態表示**のみ（2×2 グリッドの実レイアウト・カード配置は #19＝`ui.md` のワイヤーフレームが正）。

| 状態 | F1 の表示 |
|------|----------|
| 初期/ローディング | entries 取得中のプレースホルダ（「読み込み中…」） |
| 空（entries 0 件） | 空状態プレースホルダ（「表示するノートがありません」） |
| ready | コンテナを確保しマトリクス領域の枠を描画（カード配置は #19 で充填） |

- Obsidian テーマ変数（`--background-*`／`--text-*`）に追従しライト/ダーク両対応。`role`/`aria-label` を持たせ、キーボードフォーカス可能なランドマークにする。
- 詳細な画面構成・2×2 レイアウト・カード操作・a11y は `ui.md`（kind:ui）を真実源とし、本領域はアダプタ↔UI の橋渡し契約に責務を限定する。
