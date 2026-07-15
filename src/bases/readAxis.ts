/**
 * 軸プロパティの解決（ビュー options 主・設定デフォルト）と、1 軸値の kind-aware 読み取り
 * （#19 F2・#33 で absent 判定を是正・#34 で boolean 軸限定に狭め・#121 v0.3-1a で数値しきい値軸へ一般化）。
 *
 * Bases API 接触（`config.getAsPropertyId`／`entry.getValue`）をアダプタ層に閉じ込める。読み取りは
 * `toAxisRaw`（Obsidian `Value` を `instanceof` で {@link AxisRaw} へ振り分け）→ `interpretAxis`（純ロジック #120）
 * の経路で、各軸の**配置側（`side`）とロック（`locked`）**を求める（{@link readSingleAxisReading}／{@link readAxisReadings}）:
 * - **boolean 軸**（値が `BooleanValue`）は `isTruthy()` で配置・非ロック（#34 の挙動を維持＝回帰不変）。
 * - **数値しきい値軸**（当該軸に threshold あり・値が `NumberValue`）は `value >= threshold` で配置側を決め、
 *   有限数は**非ロック（掴める）**＝#122 1b で書き戻しを解禁した（書き戻しは `writeBackAxes`→`planWriteBack`。
 *   非有限〔NaN・±Inf〕は `interpretAxis` が未分類＋locked に倒す）。threshold 未設定の軸の `NumberValue` は
 *   v1 のまま未分類＋locked（不意の配置を防ぐ off-sentinel ゲート）。
 * - **absent**（`NullValue`）は未分類・非ロック（欠損は分類として新規に書けるため破壊しない・#33 の区別を包含）。
 * - **未対応 Value 型**（数値軸への文字列＝型不一致・`ErrorValue`・`ListValue` 等 `toAxisRaw` が `null` を返すもの）・
 *   `getValue` 例外は安全側で未分類＋locked（非 boolean を両軸 `true/false` 上書きで破壊する事故を防ぐ）。
 *
 * 型同一性（instanceof）で判定するのは #33 の知見による: 旧実装の `toString()===null` は実機の
 * `NullValue.toString()` が文字列 "null" を返す（型契約どおり string）ため機能せず、`constructor.name`
 * も実機は minify 済み（`"t"`）で壊れる。instanceof は prototype チェーンで成立し文字列表現・minify に依存しない。
 *
 * Value クラス（`BooleanValue`／`NullValue`／`NumberValue`／`StringValue`）は obsidian から値 import する
 * （実機は外部提供・esbuild external）。型は `import type`、単体テストは vitest が obsidian の値 import を
 * `src/test-support/obsidianStub.ts` へ解決する。⚠️ スタブ＝実機の同値性は単体では検証不能（`instanceof` の
 * 実機成立は `scripts/e2e` の placements 検証で担保）。`ErrorValue` は obsidian が型を export しないため
 * `toAxisRaw` の既定ロック（未対応型）で吸収し、個別 `instanceof` はしない（設計は `docs/design/bases.md`）。
 */
import { BooleanValue, NullValue, NumberValue, StringValue } from "obsidian";
import type { BasesEntry, BasesPropertyId, BasesViewConfig, Value } from "obsidian";
import type { EisenhowerSettings } from "../settings";
import type { AxisValues } from "../logic/quadrant";
import { interpretAxis } from "../logic/axis";
import type { AxisRaw, AxisReading, AxisSpec } from "../logic/axis";
import type { NumberThresholds } from "./numberThreshold";

/**
 * Bases ビュー options のキー。F4（#21）の軸プロパティ設定 UI がこのキーに書き込み、
 * 本層は `config.getAsPropertyId(key)` で解決する。
 */
export const URGENT_OPTION_KEY = "urgentProperty";
export const IMPORTANT_OPTION_KEY = "importantProperty";
/** 完了プロパティ（#105 F10）のビュー options キー。`config.getAsPropertyId(key)` で解決する。 */
export const COMPLETION_OPTION_KEY = "completionProperty";

/** 解決済みの両軸 propertyId。 */
export interface AxisPropertyIds {
  urgent: BasesPropertyId;
  important: BasesPropertyId;
}

/** 設定のプロパティ名（例: "urgent"）を note プロパティ ID（`note.urgent`）にする。 */
function toNotePropertyId(name: string): BasesPropertyId {
  return `note.${name}` as BasesPropertyId;
}

/**
 * churn 対象の Bases 接触点（`getAsPropertyId`／`getValue`／`config.get`）の失敗を、
 * キー（propertyId／option キー）単位で**一度だけ** `console.error` する共有ヘルパ。
 * `resolveAxisPropertyIds`／`toViewModel` は再描画毎に呼ばれるため、throw が続くと同一キーの
 * ログでコンソールを埋める。log-once 規律を 1 箇所に集約し、各境界ガード（`safeGetAsPropertyId`／
 * `readAxisValueSafely`／`readBadges` の `readBadgeText`／`stagnationThreshold` の `safeGetOption`）が
 * これへ委譲することで、観測性ポリシーの変更（warn への格下げ・リセット等）が全接触点へ一斉に効く
 *（レビュー指摘: 境界ガードの log-once 複製を単一化）。try/catch と戻り値センチネルは用途ごとに
 * 異なるため各ガードに残し、**ログ方針だけ**を共有する。
 */
export function logChurnFailureOnce(
  seen: Set<string>,
  key: string,
  message: string,
  error: unknown,
): void {
  if (seen.has(key)) return;
  seen.add(key);
  console.error(`[Eisenhower Matrix] ${message}`, error);
}

/** `note.` 接頭辞。書き戻し可能なのはこの名前空間（frontmatter）のプロパティのみ。 */
const NOTE_PROPERTY_PREFIX = "note.";

/**
 * 「書き戻せる `note.*` 軸か」を判定する単一述語（軸許容ルールの真実源・#21 F4）。
 *
 * `note.<key>`（非空キー）のみ true を返し、`formula.*`／`file.*`／空キー（bare `note.`）を弾く。
 * options の `filter`（選択時に弾く＝`viewOptions.buildAxisViewOptions`）・読み取り（{@link readSingleAxisReading}）・
 * 書き戻し（{@link toFrontmatterKey}／`EisenhowerBasesView.writeBackAxes`）の 3 面がこの述語を共有し、
 * 「選べるのに壊れる／読めるのに書けない」非対称を防ぐ。
 */
export function isWritableAxisProperty(propertyId: BasesPropertyId): boolean {
  const raw = propertyId as unknown as string;
  // Bases API / config から予期しない値（null/undefined/非文字列）が渡っても
  // startsWith で throw せず false を返す（Bases 境界の防御。churn 耐性）。
  return (
    typeof raw === "string" &&
    raw.startsWith(NOTE_PROPERTY_PREFIX) &&
    raw.length > NOTE_PROPERTY_PREFIX.length
  );
}

/**
 * 軸 propertyId から frontmatter の書き戻しキーを取り出す（#20 F3 のドラッグ書き戻し用）。
 * 書き戻し可能な `note.<key>`（{@link isWritableAxisProperty}）のみ `<key>` を返す。
 * `formula.*`／`file.*`／空キーは frontmatter へ書き戻せないため `null` を返す（呼び出し側は Notice 等で弾く）。
 */
export function toFrontmatterKey(propertyId: BasesPropertyId): string | null {
  if (!isWritableAxisProperty(propertyId)) return null;
  return (propertyId as unknown as string).slice(NOTE_PROPERTY_PREFIX.length);
}

/**
 * `config.getAsPropertyId(key)` を **throw させない**境界防御でくるむ（`getValue` と対称・レビュー指摘 #3）。
 *
 * `getAsPropertyId` は `getValue` と並ぶ churn 対象の Bases 接触点で、破壊的変更・内部不整合で throw しうる。
 * これは `resolveAxisPropertyIds`（描画経路 `toViewModel`・書き戻し経路 `resolveWritableAxisKeys` の双方から呼ばれる）
 * で走るため、throw が伝播すると `onDataUpdated` まで壊れて**ビュー全体の再描画が失敗**する（`getValue` の per-card
 * degradation より重い全件失敗）。例外時は `null`（未設定相当）へ倒し、呼び出し側の設定デフォルト（`note.<name>`）
 * フォールバックに載せる＝軸解決が壊れても既定軸で描画を続ける。
 */
/**
 * 既にログ済みの失敗 option キー。`resolveAxisPropertyIds` は描画・データ更新毎に呼ばれるため、
 * `getAsPropertyId` が失敗し続けると同一キーのログでコンソールを埋める。`loggedGetValueFailures` と
 * 同様にキー単位で 1 回に間引く（レビュー指摘）。
 */
const loggedGetAsPropertyIdFailures = new Set<string>();

export function safeGetAsPropertyId(
  config: Pick<BasesViewConfig, "getAsPropertyId"> | undefined | null,
  key: string,
): BasesPropertyId | null {
  if (config == null) return null;
  try {
    return config.getAsPropertyId(key);
  } catch (error) {
    logChurnFailureOnce(
      loggedGetAsPropertyIdFailures,
      key,
      "config.getAsPropertyId failed; using default axis",
      error,
    );
    return null;
  }
}

/**
 * 軸 propertyId を解決する。ビュー options（`config.getAsPropertyId`）を主とし、
 * 未設定（null）なら設定タブのデフォルト（`note.<name>`）にフォールバックする（要件 F4）。
 */
export function resolveAxisPropertyIds(
  config: Pick<BasesViewConfig, "getAsPropertyId"> | undefined | null,
  settings: EisenhowerSettings,
): AxisPropertyIds {
  const urgent =
    safeGetAsPropertyId(config, URGENT_OPTION_KEY) ??
    toNotePropertyId(settings.defaultUrgencyProperty);
  const important =
    safeGetAsPropertyId(config, IMPORTANT_OPTION_KEY) ??
    toNotePropertyId(settings.defaultImportanceProperty);
  return { urgent, important };
}

/** ドラッグ書き戻し先の frontmatter キー（両軸とも書き戻し可能な `note.*` のとき）。 */
export interface WritableAxisKeys {
  urgent: string;
  important: string;
}

/**
 * 書き戻し先の frontmatter キーを解決する（#20 F3 ドラッグ書き戻し・#21 F4 実行時ガード）。
 *
 * 軸 propertyId を解決（ビュー options 主・設定デフォルト）し、両軸とも書き戻し可能な `note.<key>`
 * なら `{ urgent, important }`（frontmatter キー）を返す。**片方でも非 `note.*`（`formula.*`／`file.*`／
 * 空キー）なら `null`** を返し、呼び出し側（`EisenhowerBasesView.writeBackAxes`）は frontmatter に
 * 触れる前に Notice で弾く（AC3＝書込不可軸のとき frontmatter を壊さない）。
 *
 * `writeBackAxes` は `extends BasesView` で単体対象外のため、ガード判定（どの軸が書けるか）の純度を
 * 本関数へ切り出して単体テストで固定する（`safeRegisterBasesView` と同じ流儀）。
 */
export function resolveWritableAxisKeys(
  config: Pick<BasesViewConfig, "getAsPropertyId"> | undefined | null,
  settings: EisenhowerSettings,
): WritableAxisKeys | null {
  const ids = resolveAxisPropertyIds(config, settings);
  const urgent = toFrontmatterKey(ids.urgent);
  const important = toFrontmatterKey(ids.important);
  if (urgent === null || important === null) return null;
  // 両軸が同一 frontmatter キーだと、書き戻しが同じキーを 2 度書いて後勝ちで潰れ（両軸が同値になり）
  // カードが意図しない象限へ飛ぶ。設定ミスなので書き戻し前に弾く（Notice で通知・レビュー指摘の question）。
  // ⚠️ この同一キーブロックは **kind 非依存**（tag×tag×異 tagName も一律 null）。読み取り側 {@link axesShareWritableKey}
  // は #124 で kind-aware 化したが、ここは boolean 固定のまま＝タグ軸アダプタ配線の後続 L2 で、tag×tag×異 tagName
  // を書き込み側でも合法化（別タグの add/remove を許す）よう kind-aware 化して同期する必要がある。
  if (urgent === important) return null;
  return { urgent, important };
}

/**
 * 両軸が**同一の書き戻し可能 `note.*` キー**を指す設定が「設定ミス」か（＝全カードをロックすべきか）を、
 * **kind＋tagName を考慮して**判定する（#124 タグ軸基盤）。
 *
 * 同一キーだと（tag 軸の別タグ同居を除き）両軸値が常に同値・相互に潰し合い、カードは do/delete の実象限に
 * 載って掴めるのに書き戻しは `resolveWritableAxisKeys` の `urgent === important` ガードで毎回 `null`→Notice→
 * ロールバックになる（「掴めるのに必ず失敗する」壊れた UI 状態）。UI 側で当該ビューの全カードをドラッグ不可
 *（`locked`）にするために、`toViewModel` がこの述語で検出する（書き込み前ガードと対の読み取り側ガード）。
 *
 * ⚠️ **書き込み側との対称性は boolean 既定でのみ成立**（#124 では読み取り側の本述語だけを kind-aware 化した）。
 * 書き込み側 {@link resolveWritableAxisKeys} は kind 非依存で `urgent === important` を一律ブロックするため、
 * タグ軸アダプタが配線される後続 L2 では**書き込み側も同じ kind-aware 化で同期**する必要がある（さもないと
 * tag×tag×異 tagName が「読み取り側は unlock・書き込み側は必ず `null`→Notice→ロールバック」になり、まさに
 * 本述語が塞ごうとしている「掴めるのに必ず失敗する」状態を書き込み側で再現する）。
 *
 * kind 別の扱い（決定・人間承認・設計は `docs/design/bases.md`「同一キーガードの kind-aware 化」節）:
 * - **boolean/number/select** の同一キー → 設定ミス（同一キーへ 2 度書いて後勝ちで潰れる）。
 * - **tag×tag** の同一キー → **tagName が異なれば合法**（`tags` 1 本に urgent/important の 2 タグ＝タグ軸の
 *   本命。タグ配列は別タグが安全に同居でき、`planAxisWrite` が他要素温存で add/remove する非破壊）。
 *   同一 tagName は互いに toggle し潰し合うため設定ミス。
 * - **異 kind の同一キー**（例 tag×boolean） → frontmatter の 1 キーは 1 値型しか持てず共存不能のため設定ミス。
 *
 * `specs` は各軸の {@link AxisSpec}（`src/logic/axis`＝kind/tagName の真実源）。**省略時は両軸 boolean 既定**で、
 * v1 の boolean 固定呼び出し（`toViewModel.buildDiagnostics`）は挙動不変（同一キー→衝突）＝非回帰。
 *
 * 2 軸の直接比較で判定する（両軸とも書き戻し可能な `note.*` で同一キー）。かつて N キー汎用ヘルパへ
 * 一般化したが、本番は 2 キー固定のみ・軸×完了の衝突は {@link resolveCompletionId} が pairwise で別途
 * 判定するため、汎用化は使われず YAGNI だった（v0.2 レビューで 2 軸直接比較へ戻した）。
 */
export function axesShareWritableKey(
  ids: AxisPropertyIds,
  specs: { urgent: AxisSpec; important: AxisSpec } = {
    urgent: { kind: "boolean" },
    important: { kind: "boolean" },
  },
): boolean {
  const urgent = toFrontmatterKey(ids.urgent);
  const important = toFrontmatterKey(ids.important);
  // 両軸とも書き戻し可能（非 null）で同一キーのときだけ衝突を評価する
  //（非 note.* は書けないため衝突対象外＝別ガードが弾く）。
  if (urgent === null || urgent !== important) return false;
  // 同一の書き戻し可能キー: tag×tag×異 tagName のみ合法（タグ配列の別タグ同居＝非破壊）。
  // それ以外（tag×tag×同 tagName／非 tag 同 kind／異 kind 同一キー）は全て衝突。
  if (specs.urgent.kind === "tag" && specs.important.kind === "tag") {
    return specs.urgent.tag === specs.important.tag;
  }
  return true;
}

/**
 * 完了プロパティ（#105 F10）の propertyId を解決する（既定 `done`＝初期状態で有効・空で opt-out）。
 * ビュー options（config）主・設定デフォルト（`note.<completionProperty>`）。次のとき **`null`（機能オフ）**:
 * ① 空（`completionProperty` を明示的に空へ＝opt-out。既定は `done`）かつ options 未設定
 * ② 非 `note.*`（書き戻せない）
 * ③ 完了キーが緊急/重要軸のいずれかと同一（3 キー衝突ガード・AC3＝完了書き込みが軸値を巻き添えに壊す）。
 *
 * `axes` を渡すと 3 キー衝突ガードの軸解決に再利用する（`toViewModel` は既に `resolveAxisPropertyIds` を
 * 済ませているため、渡さないと 1 レンダーで軸の `getAsPropertyId` を 2 度引く冗長解決になる・レビュー指摘）。
 * 省略時は従来どおり内部で解決する（書き戻し経路 {@link resolveCompletionKey} は解決済み軸を持たないため）。
 */
function resolveCompletion(
  config: Pick<BasesViewConfig, "getAsPropertyId"> | undefined | null,
  settings: EisenhowerSettings,
  axes?: AxisPropertyIds,
): { id: BasesPropertyId; key: string } | null {
  const fromConfig = safeGetAsPropertyId(config, COMPLETION_OPTION_KEY);
  const id =
    fromConfig ??
    (settings.completionProperty ? toNotePropertyId(settings.completionProperty) : null);
  if (id === null) return null; // 空＝無効（既定 done を明示的に空へ＝opt-out）
  const key = toFrontmatterKey(id);
  if (key === null) return null; // 非 note.*（formula/file）は書き戻せないので無効
  // 3 キー衝突ガード（AC3）: 完了キーが軸キーと同一なら無効（チェックボタンを出さない）。
  // 解決済み軸があれば再利用し、無ければ解決する（冗長な二重解決を避ける・レビュー指摘）。
  const resolvedAxes = axes ?? resolveAxisPropertyIds(config, settings);
  if (
    key === toFrontmatterKey(resolvedAxes.urgent) ||
    key === toFrontmatterKey(resolvedAxes.important)
  ) {
    return null;
  }
  return { id, key };
}

export function resolveCompletionId(
  config: Pick<BasesViewConfig, "getAsPropertyId"> | undefined | null,
  settings: EisenhowerSettings,
  axes?: AxisPropertyIds,
): BasesPropertyId | null {
  return resolveCompletion(config, settings, axes)?.id ?? null;
}

/**
 * 完了プロパティの frontmatter 書き戻しキー（#105 F10）。無効時は `null`（{@link resolveCompletionId}）。
 * `id` から `key` を再計算せず、内部 `resolveCompletion` が検証時に組んだ `key` を再利用する（レビュー指摘）。
 */
export function resolveCompletionKey(
  config: Pick<BasesViewConfig, "getAsPropertyId"> | undefined | null,
  settings: EisenhowerSettings,
): string | null {
  return resolveCompletion(config, settings)?.key ?? null;
}

/** 完了プロパティの読み取り結果（#105 F10）。 */
export interface CompletionState {
  /** 完了（`done: true`）か。淡色表示＋☑ 状態に使う。 */
  completed: boolean;
  /** 非 boolean 値（日付型等）でトグルすると破壊するため無効化するか（AC2）。 */
  unsupported: boolean;
}

/**
 * 完了プロパティ軸の値を読み、完了状態を返す（#105 F10）。`BooleanValue` は `isTruthy()` で
 * completed に、非 boolean（`getValue` の throw を含む）は `unsupported=true`（`true` 上書きで元値を
 * 破壊しないよう無効化・AC2）、absent（`NullValue`）は未完了（新規に書ける）。軸ロック
 *（{@link hasUnsupportedAxisValue}）と同型の per-card 判定を完了キーに敷く。
 */
export function readCompletionState(
  entry: BasesEntry,
  completionId: BasesPropertyId,
): CompletionState {
  const result = readAxisValueSafely(entry, completionId);
  // getValue が throw した完了軸は安全側でロック（型を確証できないまま true 上書きさせない・#2 と同型）。
  if (!result.ok) return { completed: false, unsupported: true };
  const value = result.value;
  if (isUnsupportedAxisValue(value)) return { completed: false, unsupported: true };
  const completed = value instanceof BooleanValue ? value.isTruthy() : false;
  return { completed, unsupported: false };
}

/**
 * Obsidian `Value` を純ロジック層の {@link AxisRaw}（型タグ付き生値）へ振り分ける（#121 v0.3-1a）。
 *
 * 既知型（`NullValue`＝absent／`BooleanValue`／`NumberValue`／`StringValue`）だけを分類し、
 * それ以外（実機の `ErrorValue`＝formula エラー・`ListValue`・`DateValue`・`ObjectValue`・未知の新型 等）は
 * **`null` を返す**＝呼び出し側が「未対応＝安全側ロック（未分類＋ドラッグ不可）」に倒す。obsidian 1.13.x は
 * `ErrorValue` の型を export しない（`getValue` の JSDoc が `@link ErrorValue` と言及するのみ）ため個別
 * `instanceof` はできず、この既定ロックで吸収する（脆い `constructor.name` 判定＝#33 の minify 教訓を避ける。
 * 設計は `docs/design/bases.md`「数値しきい値軸アダプタ配線」）。`NumberValue` は公開 API `Number(v.toString())`
 * で数値化する（`.data` 等の内部表現に触れない＝churn 耐性・S0）。非有限（`NaN`/`±Inf`）はそのまま数値に
 * 落ち、`interpretAxis` の number 分岐が未分類＋ロックへ倒す。tag（`ListValue`）は #125 で正の許可リストへ引き上げる。
 */
function toAxisRaw(value: Value | null): AxisRaw | null {
  if (value == null || value instanceof NullValue) return { kind: "absent" };
  if (value instanceof BooleanValue) return { kind: "boolean", value: value.isTruthy() };
  if (value instanceof NumberValue) return { kind: "number", value: Number(value.toString()) };
  if (value instanceof StringValue) return { kind: "string", value: value.toString() };
  return null; // ErrorValue / ListValue / 未対応型 → 呼び出し側が安全側ロック
}

/**
 * `entry.getValue` の読み取り結果。成功は `{ ok: true; value }`、**例外は `{ ok: false }`** で表し、
 * 「値が `null`（absent）だった」と「読み取り自体が throw した（型を確証できない）」を区別する。
 * この区別が無いと、throw を absent と同一視して**非 boolean 値のカードをロックし損ね**、
 * ドラッグ→両軸 `true/false` 上書きで元値を破壊しうる（レビュー指摘 #2）。
 */
type AxisReadResult = { ok: true; value: Value | null } | { ok: false };

/**
 * 既にログ済みの失敗 `propertyId`。同一キーの失敗を再描画毎・軸毎に `console.error` して
 * ログを埋めるのを防ぐ（防御的パスの多重ログ抑制・レビュー指摘 #4）。
 */
const loggedGetValueFailures = new Set<string>();

/**
 * `entry.getValue(id)` を **throw させない**境界防御でくるむ（churn 耐性・レビュー指摘 #3）。
 *
 * `getValue` は Bases API 接触点（churn 対象）で、型契約上は `Value | null` を返すが、未対応
 * プロパティ型・内部状態不整合・API 破壊的変更で throw しうる。1 件の entry の読み取り例外が
 * `toViewModel`→`renderCurrent`→`onDataUpdated` まで伝播すると**ビュー全体の再描画が壊れ**、
 * 他の正常カードも巻き添えになる。ここで捕捉して `{ ok: false }` を返し、呼び出し側が**用途ごとに
 * 安全側の既定**（配置は未分類・ロック判定はロック）へ倒す（`isPlaceableNote`／`isWritableAxisProperty`
 * の「Bases 境界で throw させない」防御と同じ流儀で、同期 read の境界にも対称に敷く）。
 * 同一 `propertyId` の失敗は一度だけログする（#4）。
 */
function readAxisValueSafely(entry: BasesEntry, id: BasesPropertyId): AxisReadResult {
  try {
    return { ok: true, value: entry.getValue(id) };
  } catch (error) {
    const raw = id as unknown as string;
    logChurnFailureOnce(
      loggedGetValueFailures,
      typeof raw === "string" ? raw : String(raw),
      "entry.getValue failed",
      error,
    );
    return { ok: false };
  }
}

/** 1 エントリの両軸の {@link AxisReading}（配置側 `side` ＋ ロック `locked`）。 */
export interface AxisReadings {
  urgent: AxisReading;
  important: AxisReading;
}

/** しきい値未指定（両軸 boolean 扱い＝v1）の既定。従来 2 引数呼び出し・boolean 軸の回帰用。 */
const NO_THRESHOLDS: NumberThresholds = { urgent: null, important: null };

/**
 * 1 軸を読み、配置側（`side`）とロック（`locked`）を返す（#121 v0.3-1a→#122 1b・{@link interpretAxis} へ配線）。
 *
 * - 書き戻し可能な `note.*` 以外（`formula.*`／`file.*`）は未分類・**非ロック**（書き戻し経路が無く破壊しない＝
 *   読み書き対称。「4 象限に並ぶのにドラッグすると必ず失敗するカード」を作らない）。
 * - `getValue` 例外・未対応 Value 型（`ErrorValue` 等 {@link toAxisRaw} が `null` を返すもの）は**安全側で
 *   未分類＋locked**（型を確証できないまま上書きさせない・churn 耐性）。
 * - 数値（当該軸に `threshold` あり・値が `NumberValue`）は `interpretAxis` で `value >= threshold` の配置側を決め、
 *   有限数は**非ロック（掴める）**＝#122 1b で書き戻しを解禁した（書き戻しは `writeBackAxes`→`planWriteBack`）。
 *   非有限（`NaN`/`±Inf`）は `interpretAxis` の number 分岐が未分類＋locked へ倒す（掴ませない）。
 * - `threshold` 未設定（`null`）の軸の `NumberValue` は v1 のまま未分類＋locked（不意の配置を防ぐ off-sentinel ゲート）。
 * - boolean/absent/文字列等は boolean spec 経由で v1 と同じ解釈（配置・非ロック／文字列は未分類＋locked＝#34 不変）。
 */
function readSingleAxisReading(
  entry: BasesEntry,
  id: BasesPropertyId,
  threshold: number | null,
): AxisReading {
  if (toFrontmatterKey(id) === null) return { side: undefined, locked: false };
  const result = readAxisValueSafely(entry, id);
  if (!result.ok) return { side: undefined, locked: true };
  const raw = toAxisRaw(result.value);
  if (raw === null) return { side: undefined, locked: true }; // 未対応 Value 型（ErrorValue 等）
  if (raw.kind === "number") {
    // off-sentinel ゲート: しきい値未設定の軸は数値を配置せず v1（未分類＋locked）を維持する。
    if (threshold === null) return { side: undefined, locked: true };
    // 1b（#122 で書き戻しを解禁）: 有限数は unlock（掴める＝ドラッグ書き戻しへ）＝interpretAxis の結果を
    // そのまま返す。有限→象限配置＋非ロック（ドラッグ可）／非有限（NaN・±Inf）→ interpretAxis が
    // 未分類＋locked に倒す（掴ませない）。数値の書き戻し経路は `writeBackAxes`→`planWriteBack`（#120/#122）。
    return interpretAxis(raw, { kind: "number", threshold });
  }
  // boolean/absent/string 等は boolean spec で v1 と同じ解釈（#34 不変）。
  return interpretAxis(raw, { kind: "boolean" });
}

/** 1 エントリの両軸を読み、配置側＋ロックを返す（数値しきい値軸対応・#121）。 */
export function readAxisReadings(
  entry: BasesEntry,
  ids: AxisPropertyIds,
  thresholds: NumberThresholds,
): AxisReadings {
  return {
    urgent: readSingleAxisReading(entry, ids.urgent, thresholds.urgent),
    important: readSingleAxisReading(entry, ids.important, thresholds.important),
  };
}

/**
 * 1 エントリの両軸の**配置側**（absent を区別した {@link AxisValues}）を返す。数値しきい値軸は
 * `thresholds` を渡すと `value >= threshold` で配置側へ、未指定（既定）は boolean 軸扱い（v1・#34 回帰）。
 * 本番の描画経路（`toViewModel`）は {@link readAxisReadings} を直接使い**配置側とロックを 1 度に**得る＝
 * 本関数は「配置側だけ」を要する呼び出し・boolean 回帰テスト向けの薄い委譲（単一情報源は `readAxisReadings`）。
 */
export function readAxisValues(
  entry: BasesEntry,
  ids: AxisPropertyIds,
  thresholds: NumberThresholds = NO_THRESHOLDS,
): AxisValues {
  const readings = readAxisReadings(entry, ids, thresholds);
  return { urgent: readings.urgent.side, important: readings.important.side };
}

/**
 * 値が「present だが boolean でない」（数値/文字列等）＝boolean 単一プロパティ書き戻しで**破壊される**値かを
 * 判定する（**boolean 前提の書き戻し先向けの述語**）。`null`・absent（`NullValue`）は `false`（欠損は上書きで
 * 破壊せず、分類として新規に書けるため）。`BooleanValue` も `false`（boolean→boolean は再分類で破壊でない）。
 * **absent と「非 boolean が入っている」を区別する**述語で、完了トグル（#105 F10・boolean 単一プロパティ）の
 * {@link readCompletionState} が非 boolean な完了値（日付等）を保護（トグル無効化）するのに使う。軸の kind-aware な
 * ロック判定は {@link readSingleAxisReading}（数値しきい値軸を含む・#121）が担い、本述語は boolean 前提の完了軸に閉じる。
 */
export function isUnsupportedAxisValue(value: Value | null): boolean {
  if (value == null) return false;
  if (value instanceof NullValue) return false; // absent（欠損）は破壊しない
  return !(value instanceof BooleanValue);
}

/**
 * エントリのどちらかの軸が「ドラッグ不可（locked）」か（#34 の非 boolean 破壊ガードを #121 で kind-aware 化）。
 *
 * 書込可能 `note.*` 上の**解釈できない値**＝型不一致の文字列・未対応 Value 型（`ErrorValue` 等）・`getValue`
 * 例外・非有限数（`NaN`/`±Inf`）・off-sentinel（threshold 未設定）の数値を含む。`true` のカードは UI
 *（`NoteCard`）でドラッグ不可にし、ドロップの両軸上書きによるデータ破壊を封じる。真に absent・boolean・
 * **有限数の数値軸（#122 1b で書き戻し解禁＝掴める）**のカードは `false`（ドラッグして分類できる）。判定は
 * {@link readAxisReadings} に一本化する（配置側の解釈と同じ経路＝二重管理を無くす）。`thresholds` 未指定は
 * boolean 軸扱い（v1・#34 の回帰）。
 * 本番の描画経路（`toViewModel`）は {@link readAxisReadings} の `locked` を直接見る＝本関数は「ロックだけ」を
 * 要する呼び出し・回帰テスト向けの薄い委譲（単一情報源は `readAxisReadings`）。
 */
export function hasUnsupportedAxisValue(
  entry: BasesEntry,
  ids: AxisPropertyIds,
  thresholds: NumberThresholds = NO_THRESHOLDS,
): boolean {
  const readings = readAxisReadings(entry, ids, thresholds);
  return readings.urgent.locked || readings.important.locked;
}
