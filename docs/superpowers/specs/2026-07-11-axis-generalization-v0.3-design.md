# v0.3 リリース計画・設計: 軸の一般化（v2 軸対応）

> 種別: リリース計画・基本設計（ブレインストーミング成果物）
> 対象リリース: v0.3（次期）
> 起点: 検討 Issue #88（数値しきい値軸・敵対的検証 strong）／ #91（テキスト・タグ軸）
> 作成: 2026-07-11 ／ 状態: draft（`/github-planning` での L1/L2 起票の入力）

このドキュメントは v0.3 の**リリース内容の検討**の成果物であり、L1 マイルストーン＋L2 Issue 群を
`/github-planning` で起票するための設計・分解を与える。実装の詳細確定（設計オプション比較・AC ウォーク
スルー）は各 L2 の「実装前設計」（`.claude/rules/alignment.md`）で行い、本書はその手前の**基本設計と
分解**に責任を持つ。

---

## 1. 背景・目的

### 解決する課題

v1／v0.2 は **boolean 軸限定**（要件定義書 §2 で v2 送り明示）。`priority: 1〜5` の数値や
`priority: high/low` の文字列、`tags: [urgent]` のタグで優先度管理している既存 Vault は軸を張れず、
これらのノートは #34 の型ガードで未分類＋ロックに落ちるだけで、中核価値（ドラッグ再分類）を享受できない。
**boolean への移行を強いない軸対応は、本プラグイン最大の制約解除**であり採用障壁の最大要因。

### v0.3 の主題（意思決定の記録）

本計画は次のすり合わせ（`.claude/rules/alignment.md`）を経て確定した:

| 論点 | 決定 | 根拠 |
|------|------|------|
| v0.3 の方向性 | **軸の一般化（数値/タグ軸）** | プロジェクト自身の階層付けで Tier B＝「v0.3 本命」。最大の採用障壁の解除 |
| スコープの広さ | **フル（数値+選択+タグ）を 1 リリースで完成** | v2 軸対応を出し切る。#91 は #88 の AxisSpec 基盤に依存するため順序は #88→#91 で固定 |
| このセッションの産出物 | **設計・計画書まで** | S0 スパイクがこの実行環境（リモートコンテナ）で回せない。実機で S0 を回してから通常フローに乗せる |

### ゴール

数値・文字列・タグで優先度管理している既存 Vault を、boolean へ移行させずに Eisenhower マトリクスへ
載せ、ドラッグ再分類しても**元の値のニュアンス（5 と 3 の差・タグの他要素）を壊さない**。

---

## 2. 現状の基盤（実コード確認・2026-07-11）

実装前に、#88／#91 が「これから作る」と想定していた基盤作業の現状を実コードで確認した。**一部は
v0.2 で既に完了しており、v0.3 の作業量を減らせる。**

### 2.1 既に出来ている（de-risk）

- **undo のキーリスト一般化は #105（完了トグル）で完了**（`src/logic/undo.ts`）。
  - `UndoRecord` は `entries: UndoEntry[]`、`UndoEntry.wrote: unknown`（verbatim・boolean 非限定）。
    コード内コメントに明示的に「**将来の数値軸 #88 に備える**」（`undo.ts:44`）。
  - `buildUndoEntries` / `applyUndo` / `isUndoApplicable` は任意キー・任意値で動作する。
  - **含意**: #88 の undo 拡張（`wrote: boolean | number`）は実質不要。数値軸はそのまま乗る。
    「越境時のみ書く（＝書いた軸だけ記録）」も、書いた `AxisWrite[]` だけを `buildUndoEntries` に
    渡せば keylist 形が自然に扱う。

### 2.2 まだ boolean 固定で改修が要る箇所

| 箇所（`src/bases/readAxis.ts`／`src/logic`） | 現状 | v0.3 での改修 |
|------|------|--------------|
| `normalizeAxis`（`readAxis.ts:290`） | `Value → boolean \| undefined`。正の許可リスト `instanceof BooleanValue` のみ | AxisSpec 対応の `interpretAxis` へ。許可リストに NumberValue/StringValue/ListValue を追加（**実機表現は S0 スパイクで確定**） |
| `isUnsupportedAxisValue`（`readAxis.ts:372`）／`isUnsupportedOnWritableAxis`／`hasUnsupportedAxisValue` | 「非 BooleanValue かつ非 NullValue ＝破壊対象＝ロック」 | **kind-aware 化**。「この spec で解釈不能な present 値」をロック（数値なら NaN/±Inf、select なら未知文字列、tag なら該当なし＝ロックしない側） |
| `axesShareWritableKey`（`readAxis.ts:194`） | 2 軸の frontmatter キー直接比較（同一キー＝設定ミス） | **kind-aware 化（タグ軸のため）**。`tags` 1 本に urgent/important の 2 タグ＝同一キーだが合法。tag×tag×異 tagName を許容する（下記 3a） |
| `classifyQuadrant`／`axisValuesForQuadrant`（`quadrant.ts`） | `boolean \| undefined` を消費／象限→`{urgent, important}` の boolean | **変更しない**（下記の設計方針） |
| `isUndoApplicable`（`undo.ts:134`） | `frontmatter[key] === entry.wrote` の `===` 厳密比較 | 数値・文字列は OK。**タグ軸（配列値）のみ値等価の補強が要る**（配列は参照比較になる） |

---

## 3. AxisSpec 基盤設計

### 3.1 設計方針: 象限ロジックは boolean のまま、軸解釈の両端だけ一般化

`classifyQuadrant`（値の側→象限）と `axisValuesForQuadrant`（象限→値の側）は**一切変えない**。
AxisSpec が一般化するのは次の 2 つの端だけ:

```
[Value 生値] --interpretAxis(raw, spec)--> [boolean | undefined（軸の側）] --classifyQuadrant--> [象限]
[象限] --axisValuesForQuadrant--> [boolean（目標の側）] --planAxisWrite(side, spec, current)--> [実際の書き込み or 書かない]
```

`boolean | undefined`（軸の側・未分類）が**軸解釈と象限判定の間の安定インターフェース**。この不変性が
「boolean 軸は挙動不変（回帰テストで固定）」を保証し、churn 面を読み取り端・書き戻し端に閉じ込める。

### 3.2 型定義（純ロジック・`src/logic`）

```ts
// 軸ごとの仕様。ハイブリッド指定（ビュー options 主・プラグイン設定デフォルト）で解決する。
export type AxisSpec =
  | { kind: "boolean" }
  | { kind: "number"; threshold: number; highValue?: number; lowValue?: number }
  | { kind: "select"; trueValue: string; falseValue: string }
  | { kind: "tag"; tagName: string };

// アダプタ（readAxis）が Value を正規化した型付き生値。§4 で instanceof 判別・取り出しを確定済み。
export type AxisRaw =
  | { kind: "absent" }                       // NullValue（instanceof NullValue・#33）
  | { kind: "boolean"; value: boolean }      // BooleanValue → isTruthy()
  | { kind: "number"; value: number }        // NumberValue → Number(v.toString())
  | { kind: "string"; value: string }        // StringValue → v.toString()
  | { kind: "list"; value: ListValue }       // ListValue（要素 TagValue・`#` 前置）→ includes/length/get
  | { kind: "unsupported" };                 // getValue throw／ErrorValue／未知型
```

> **取り出しは公開 API**（§4 確定）: PrimitiveValue に公開 getter が無いため、数値は `Number(v.toString())`・
> 文字列は `v.toString()`。list は生 `.data` を手パースせず **`ListValue.includes(new TagValue(name))`**
> （loose-equals・`#` 前置吸収は 3b で実機確認）を使う。`kind: "list"` は解釈で native API を叩くため
> ListValue 自体を保持する（`string[]` に潰さない）。判別は全 kind **instanceof**（minified 名に依存しない）。

### 3.3 `interpretAxis(raw, spec): { side: boolean | undefined; locked: boolean }`（純関数）

`side` は既存 `AxisValues` に渡す軸の側（`undefined`＝未分類）。`locked` は present だが spec で解釈
不能でドラッグ→書込が破壊になる値か（現 `isUnsupportedAxisValue` の kind-aware 版）。

| spec.kind | raw | side | locked |
|-----------|-----|------|--------|
| boolean | boolean | 値 | false |
| boolean | 非 boolean present（number/string/list） | undefined | **true** |
| number | number（有限） | `value >= threshold` | false |
| number | number（NaN/±Inf） | undefined | true |
| number | 非 number present | undefined | true |
| select | string == trueValue | true | false |
| select | string == falseValue | false | false |
| select | 未知 string | undefined | **true**（未知値を書き潰さない） |
| tag | list に tagName 含む | true | false |
| tag | list present で tagName 無し | **false**（下記 未決 3.6①） | false |
| 全 kind | absent（NullValue） | undefined | **false**（欠損はドラッグして新規分類可） |
| 全 kind | unsupported（throw） | undefined | true（安全側ロック） |

### 3.4 `planAxisWrite(side, spec, current): AxisWrite | null`（純関数）

`side`＝`axisValuesForQuadrant` が返す目標の側。`current`＝現在の `AxisRaw`。返り値 `null`＝書かない。

| spec.kind | ルール |
|-----------|--------|
| boolean | 常に `true`/`false` を書く（**挙動不変**・回帰で固定） |
| number | 既に目標の側なら **書かない（値温存）**。越境／absent なら代表値（`highValue ?? threshold` ／ `lowValue ?? threshold - 1`）を書く |
| select | 既に目標側の値なら書かない。越境／absent なら `trueValue`／`falseValue` を書く |
| tag | side=true → 配列に tagName を**追加**（他要素温存・全置換しない）。side=false → tagName を**除去**。absent → true 側は新規配列を作る |

**書いた軸だけを** `buildUndoEntries` に渡す（§2.1）。boolean 軸との混在（片軸だけ数値等）は各軸が独立に
`interpretAxis`／`planAxisWrite` を通るため自然に成立。

### 3.5 undo との接続

- 数値・select は verbatim `wrote` と `===` 照合でそのまま可（§2.1）。
- **tag は配列値のため `isUndoApplicable` の `===` が効かない** → 値等価（要素集合の一致）に補強する
  純関数を足す（下記 3b）。`applyUndo` の復元（present は代入／absent は delete）は配列でも既に正しい。

### 3.6 各 L2 の実装前設計に送る未決論点（設計オプション比較＋人間承認の対象）

1. **タグ軸の absent/false 意味論**: 「tags キー無し＝未分類、tags 有りで当該タグ無し＝false」の非対称が
   ユーザー期待（タグが無い＝非緊急）とズレる（#91）。tag サブ（3b）の実装前設計で確定。
2. **select の 3 値以上運用**: `trueValue`/`falseValue` 二値必須のため `high/medium/low` の medium が全て
   locked になる。二値運用に効く割り切りを設計書と README に明示（select サブ 2）。
3. **数値の代表値デフォルト**: `highValue ?? threshold`／`lowValue ?? threshold - 1` が妥当か。しきい値
   変更で既存ノートの象限が見かけ上一斉に動く（**書込は発生しない＝データ安全**だが視覚的驚き）ことの
   明示（数値サブ 1b）。
4. **Configure view の options 表現力**: ~~kind 選択＋条件付きフィールドを宣言型 options で表せるか~~
   → **S0 で解決（§4）**。`options: (config) => BasesAllOptions[]`（config 関数）＋ 各 option の `shouldHide`
   ＋ `dropdown`/`slider`/`text`/`group` で、kind 選択＋条件付きフィールドはネイティブに実現可能。縮退案は不要。

---

## 4. S0 スパイク（実機ゲート）— 実行済み・確定（2026-07-12）

実機 Obsidian **1.12.7** で実行済み（`scripts/e2e/probe-s0.sh` ＋ `probe-s0.js`・CDP 方式・#16/#33/#44 と
同流儀）。分離テスト Vault に数値/文字列/タグ/boolean/absent のフィクスチャを置き、`entry.getValue` の
返す Value を introspect した。生ログ＝`out/probe-s0-{result.json,console.log}`。あわせて obsidian の型定義
（`node_modules/obsidian/obsidian.d.ts`）で公開 API・export 名を確定した。**S0 の全項目が解決**した。

### 確定した Value 表現（`AxisRaw` の許可リスト＝§3.2 の入力）

| frontmatter | 実機 Value | 判別（instanceof） | primitive 取り出し（公開 API） | 備考 |
|-------------|-----------|-------------------|------------------------------|------|
| `flag: true` | BooleanValue | `instanceof BooleanValue`（既存・実証済み） | `isTruthy()` | 変更なし |
| `score: 3` | **NumberValue** | `instanceof NumberValue` | **`Number(v.toString())`** | `toString()="3"`。`.data` に生値もあるが公開 getter が無いため **toString 経由**が churn 耐性で優る |
| `level: high` | **StringValue** | `instanceof StringValue` | **`v.toString()`** | `toString()="high"` |
| `tags: [urgent, work]` | **ListValue**（要素は **TagValue**） | `instanceof ListValue` | **`v.includes(new TagValue(name))`／`v.length()`／`v.get(i)`** | ⚠️ **タグは `#` 前置**（`#urgent`）。包含は `.data` 手パースでなく**ネイティブ `includes(value: Value)`（loose-equals）**を使う |
| （キー欠損） | NullValue（singleton） | `instanceof NullValue`（既存・#33） | — | `toString()="null"`（文字列・#33 再確認）・`isTruthy()=false`・`equals` あり |

> **export 名は obsidian.d.ts で確定**: `BooleanValue`/`NumberValue`/`StringValue`/`ListValue`/`TagValue`/
> `DateValue`/`NullValue` すべて export（`NumberValue`/`StringValue` は `PrimitiveValue<T>` 派生、`TagValue
> extends StringValue`）。全 Value は実機で minified constructor `"t"` のため **instanceof で判別**（名前・
> toString に依存しない＝#33 の教訓を踏襲）。⚠️ **`getValue` はエラーを `ErrorValue` で返す**（formula 失敗
> 等・d.ts 明記）→ 現行 `readAxisValueSafely` の try/catch に加え、`instanceof ErrorValue` も unsupported
> （安全側ロック）へ倒す。`obsidianStub.ts` に `ListValue`/`TagValue`/`ErrorValue`（＋既存の Number/String）
> を実機表現に合わせて追加する。

### 確定した options 型（§3.6④＝条件付きフィールドの可否）

**結論: kind 選択＋条件付きフィールドはネイティブに実現可能。縮退案は不要。**

- `registerBasesView` の `registration.options` は **`(config: BasesViewConfig) => BasesAllOptions[]`**
  ＝ **config を受け取る関数**。現在の `kind` を読んで返すオプション集合を変えられる。
- 使える option 型: `BasesOptions = dropdown | slider | text | multitext | toggle | property | file |
  folder | formula`。加えて各 option に **`shouldHide?: () => boolean`**（1.10.2〜）、折りたたみ
  **`BasesOptionGroup`（`type:'group'`・`items[]`・`shouldHide`）** あり。
- 割り当て: **kind 選択＝`dropdown`**（`{type:'dropdown', options: Record<string,string>}`）／数値しきい値・
  代表値＝`slider` か `text`／select の trueValue/falseValue＝`text`／tag の tagName＝`text`／軸プロパティ＝
  既存 `property`（`filter` で `note.*` 絞り継続）。**条件付き表示は `options(config)` の分岐 ＋ `shouldHide`
  の二重手段**で実装する。

### 残る実機確認（各 L2 の結合フェーズで担保・S0 では非ブロッキング）

- **書き戻し往復（各 kind）**: `processFrontMatter` で数値/文字列/配列を書き `onDataUpdated` 再発火で
  再配置されるか（既存 boolean 往復は実証済み。tag は配列 add/remove で他要素温存を実機確認）。
- **`ListValue.includes` の loose-equals が `#` 前置・大小差を吸収するか**（tag 軸 3b の設計前提。実機で
  `list.includes(new TagValue("urgent"))` が `#urgent` にヒットするか確認）。
- これらは「読み取り許可リスト・options 型」の確定（S0 の本題）とは別で、各 L2 の TDD＋結合で担保する。

---

## 5. L2 分解（サブプロジェクト）

依存順。1 リリースで全部出すが、内部は連鎖する複数 L2 に割る（`.claude/rules/scale.md`「L2 分割」）。
「この環境」列＝S0 スパイク不要でリモート環境でも着手可能か。

| # | L2 | 概要 | 状態 | 依存 |
|---|----|------|:---:|------|
| **S0** | Bases 軸型スパイク | §4 **実行済み・確定（2026-07-12・実機 1.12.7）**。Value 許可リスト（Number/String/List/Tag/Error）・options 型（dropdown+slider+text+group+shouldHide）を確定。以降の配線ゲート解除 | ✅ 済 | — |
| **F0** | AxisSpec 基盤（純ロジック） | `AxisSpec`／`AxisRaw` 型・`interpretAxis`・`planAxisWrite` を TDD（§3）。undo は #105 流用。Value 表現に非依存 | 未 | — |
| **1a** | 数値軸 読み取り/表示 | `readAxis` を AxisSpec 対応（`normalizeAxis`→`interpretAxis` 配線・`instanceof NumberValue`＋`Number(toString())`）・locked 判定 kind-aware 化（`ErrorValue` も安全側ロック）。**書き戻し無し（locked）でも出荷可能な段階** | 未（S0 解決済） | S0, F0 |
| **1b** | 数値軸 書き戻し+undo | `planAxisWrite` で越境時のみ代表値・undo 既存流用・**boolean 軸は回帰で挙動不変固定** | 未 | 1a |
| **2** | 選択（select）軸 | `instanceof StringValue`＋`toString()`・trueValue/falseValue 完全一致・未知値は未分類+locked・越境時のみ書込 | 未（S0 解決済） | 1b |
| **3a** | 同一キーガードの kind-aware 化 | `axesShareWritableKey` を改修。tag×tag×異 tagName を合法化（`tags` 1 本に 2 タグ）。boolean×boolean 同一キーは従来どおり弾く | 未 | F0 |
| **3b** | タグ軸 | `instanceof ListValue`・`includes(new TagValue)` で包含（`#` 前置は loose-equals・要実機確認）・配列 add/remove（他要素温存）・absent/false 意味論確定（§3.6①）・**undo 値等価補強**（§3.5）・inline tag 非対応を明示 | 未（S0 解決済） | 3a, 1b |

### 横断作業（各 L2 に分散して実施）

- **Configure view options**（`src/bases/viewOptions.ts`）を kind 対応へ（各 kind の入力。表現力は S0 で確定）。
- **設定タブ**（`src/settingsTab.ts`）に各軸の kind＋パラメータのデフォルト。
- **i18n**（`src/i18n.ts` en/ja）新規文言（kind ラベル・エラー・設定説明）。
- **要件定義書**改訂（§7 参照）。
- **docs/design/bases.md** に AxisSpec 節（`interpretAxis`／`planAxisWrite`／許可リスト）。設計に影響する
  L2 は実装前に `status: draft` で先行更新（`.claude/rules/design-doc.md`）。
- **README** に各軸タイプの使い方と**正直な制約**: select 二値・tag は frontmatter 限定（inline `#tag`
  非対応）・数値はしきい値へ丸め（連続値のニュアンスは分類には出ない）・formula 由来の数値緊急度は
  書き戻し不可制約で恒久的に対象外。

### 順序（フェーズ）

依存は上表「依存」列が正。フェーズで見ると:

| フェーズ | L2（並行可） | 依存 |
|---------|------------|------|
| 0 | **S0**（実機ゲート）／ **F0**（純ロジック） | なし（2 つは並行着手可） |
| 1 | **1a**（数値 読み取り/表示）／ **3a**（同一キーガード kind-aware 化） | 1a←S0,F0 ／ 3a←F0 |
| 2 | **1b**（数値 書き戻し+undo） | 1a |
| 3 | **2**（select 軸）／ **3b**（tag 軸） | 2←1b ／ 3b←3a,1b |
| — | リリース cut | 2 と 3b の完了時 |

F0 は S0 の結果を待たず**この環境で先行着手できる**（純ロジックは Value 表現に非依存）。実機作業（S0）と
純ロジック（F0）を並行させ、S0 完了後にアダプタ配線（1a の instanceof 許可リスト・options UI）を乗せる。

---

## 6. 非機能・横断的関心事

- **データ安全（最優先）**: 「同じ側なら書かない・越境時のみ書く」で連続値/タグの他要素を壊さない。
  解釈不能な present 値は locked でドラッグ→書込を封じる（§3.3）。万一の書込も undo で verbatim 復元可能
  （§2.1）。boolean 軸は挙動不変を回帰テストで固定。
- **churn 耐性**: Value 表現の instanceof はアダプタ（`readAxis`）に隔離。純ロジック（`interpretAxis`／
  `planAxisWrite`）は Value 型に非依存。象限ロジックは不変。
- **a11y**: 新規 options/設定 UI・ロック理由の表示（現行 completion の locked 説明と同型）・SR 文言。
- **性能**: 追加は per-entry の型分岐のみ。数百件の非仮想化方針は不変（要件 §9 の性能未決は本計画で変えない）。
- **desktop-only 不変**: 本計画はモバイル対応（#99）を含まない。`isDesktopOnly: true` は維持。

---

## 7. 要件定義書・設計書への反映方針

- **§2 スコープ**: 「数値しきい値・テキスト/タグ軸の書き戻し＝v2 以降」の**将来送りを解除**（v0.3 で実施）。
- **§3 主要機能**: F4（軸プロパティ設定）を AxisSpec（kind 別）対応へ改訂、または新規 F 行「軸タイプ
  （数値/選択/タグ）」を追加（planning の起票前ゲートで確定）。
- **§9 未決事項**: S0 スパイクの結果（Value 表現・options 型）を確定して記録。§3.6 の各論点は L2 の実装前
  設計で解消したら本文改訂＋変更履歴へ。
- **§10 変更履歴**: v0.3 着手（軸の一般化）の合意を追記。
- すり合わせの記録先は `.claude/rules/alignment.md`「記録先の対応表」に従う。

---

## 8. スコープ外（この計画に含めない）

- モバイル/タッチ対応（#99）・複数選択ドラッグ（#98）・並べ替え永続化（#97）・埋め込み（#100）＝別リリース。
- 多段 undo（#93）・WIP 警告（#90）・右クリックメニュー（#89）等の Tier C QoL＝v0.3 に同乗させない
  （軸の一般化に集中）。必要なら独立に任意リリースへ。
- formula 由来の数値緊急度（期日からの導出）＝書き戻し不可制約で恒久的に対象外（読み取り専用バッジ #104
  で表示はできる）。

---

## 9. 次のアクション

1. 本書をレビュー・合意（人間ゲート）。
2. ~~実機で S0 スパイクを回す~~ → **完了（2026-07-12・実機 1.12.7）**。Value 許可リスト・options 型を
   §4 に確定。プローブは `scripts/e2e/probe-s0.{sh,js}`（throwaway・再実行可）。
3. **要件定義書 §9「未決事項」に S0 結果を反映**（Value 表現・options 型の確定。`/github-planning` 起票時
   または先行して人間承認のうえ）。§2 の v2 送り解除・§3 の F 行方針も同時に確定。
4. `/github-planning` で v0.3 マイルストーン＋L2 群（F0/1a/1b/2/3a/3b）を起票（起票前ゲートで AC
   ウォークスルー＋依存 `> 依存:` の記録）。
5. 各 L2 を `/dev-tasks`（実装前設計→TDD→レビュー）で実装。**F0 は依存なしで即着手可**（S0 解決済）。
