/**
 * 軸プロパティの解決と、1 軸値の absent/非 boolean/true/false 正規化
 * （#19 F2・#33 で absent 判定を是正・#34 で boolean 軸限定の型ガードに狭める）。
 *
 * Bases API 接触（`config.getAsPropertyId`／`entry.getValue`）をアダプタ層に閉じ込める。
 * v1 は **boolean 軸限定**のため、`normalizeAxis` は **値の型が `BooleanValue` の軸だけ**を
 * `isTruthy()` で boolean 化し、それ以外（absent＝`NullValue`・非 boolean＝`NumberValue`／
 * `StringValue` 等）は `undefined`（未分類）へ退避する（正の許可リスト `instanceof BooleanValue`・#34）。
 * これにより非 boolean の `note.*` 軸が 4 象限に並んでドラッグ→両軸 `true/false` 上書きで
 * 元の数値/文字列を破壊する事故（データ損失）を防ぐ。absent（`NullValue`）も非 `BooleanValue` として
 * 自然に未分類へ落ちるため、#33 の absent 区別（欠損を最低象限 Delete に誤分類しない）を包含する。
 *
 * 型同一性（instanceof）で判定するのは #33 の知見による: 旧実装の `toString()===null` は実機の
 * `NullValue.toString()` が文字列 "null" を返す（型契約どおり string）ため機能せず、`constructor.name`
 * も実機は minify 済み（`"t"`）で壊れる。instanceof は prototype チェーンで成立し文字列表現・minify に依存しない。
 *
 * `BooleanValue`（値）は obsidian から import する（実機は外部提供・esbuild external）。型は `import type`、
 * 単体テストは vitest が obsidian の値 import を `src/test-support/obsidianStub.ts`（`BooleanValue`／
 * `NullValue`／`NumberValue`／`StringValue` を提供）へ解決する。⚠️ スタブ＝実機の同値性は単体では
 * 検証不能（`instanceof BooleanValue` の実機成立は `scripts/e2e` の placements 検証で担保）。
 */
import { BooleanValue, NullValue } from "obsidian";
import type { BasesEntry, BasesPropertyId, BasesViewConfig, Value } from "obsidian";
import type { EisenhowerSettings } from "../settings";
import type { AxisValues } from "../logic/quadrant";

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
 * options の `filter`（選択時に弾く＝`viewOptions.buildAxisViewOptions`）・読み取り（{@link readSingleAxis}）・
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
  if (urgent === important) return null;
  return { urgent, important };
}

/**
 * 両軸が**同一の書き戻し可能 `note.*` キー**を指すか（設定ミス）を判定する。
 *
 * 同一キーだと両軸値が常に同値になり、カードは do/delete の実象限に載って掴めるのに、書き戻しは
 * `resolveWritableAxisKeys` の `urgent === important` ガードで毎回 `null`→Notice→ロールバックになる
 *（「掴めるのに必ず失敗する」壊れた UI 状態）。UI 側で当該ビューの全カードをドラッグ不可（`locked`）に
 * するために、`toViewModel` がこの述語で検出する（書き込み前ガードと対称の読み取り側ガード・レビュー指摘）。
 *
 * 2 軸の直接比較で判定する（両軸とも書き戻し可能な `note.*` で同一キー）。かつて N キー汎用ヘルパへ
 * 一般化したが、本番は 2 キー固定のみ・軸×完了の衝突は {@link resolveCompletionId} が pairwise で別途
 * 判定するため、汎用化は使われず YAGNI だった（v0.2 レビューで 2 軸直接比較へ戻した）。
 */
export function axesShareWritableKey(ids: AxisPropertyIds): boolean {
  const urgent = toFrontmatterKey(ids.urgent);
  const important = toFrontmatterKey(ids.important);
  // 両軸とも書き戻し可能（非 null）で同一キーのときだけ衝突（非 note.* は書けないため衝突対象外）。
  return urgent !== null && urgent === important;
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
 *（{@link isUnsupportedOnWritableAxis}）と同型の per-card 判定を完了キーに敷く。
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
 * 1 軸の Value を boolean | undefined に正規化する（v1 は boolean 軸限定・#34）。
 * `getValue` 自体の null と、値の型が `BooleanValue` でないもの（absent＝`NullValue`・
 * 非 boolean＝`NumberValue`／`StringValue` 等）を `undefined`（未分類）へ退避し、
 * `BooleanValue` の値だけ `isTruthy()` で boolean 化する（正の許可リスト＝型同一性 `instanceof`）。
 * 非 boolean は `isTruthy()` の真偽ではなく**型**で退避する（falsy な数値 0・空文字を `false`＝Delete 象限に
 * 落とさない）。未知/新規の Value 型も既定で未分類になり（安全側）、v2 は許可リストに型別ブランチを足す。
 * 本関数は**値の型だけ**を見る（propertyId の `note.*` 判定は呼び出し側 {@link readSingleAxis} が担う）。
 */
function normalizeAxis(value: Value | null): boolean | undefined {
  if (value == null) return undefined; // getValue 自体の null（防御）
  // BooleanValue 以外（NullValue=absent・NumberValue・StringValue 等）は未分類へ退避し、
  // 非 boolean をドラッグ→両軸 true/false 上書き（データ破壊）させない（#34）。
  if (!(value instanceof BooleanValue)) return undefined;
  return value.isTruthy();
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

/**
 * 1 軸を読む。書き戻し可能な `note.*` 以外（`formula.*`／`file.*`）は **absent 扱い（undefined）**にして
 * 4 象限へ配置しない（未分類・ドロップ不可）。読み取り側を書き戻し側（{@link toFrontmatterKey}）と
 * 対称にし、「4 象限に並ぶのにドラッグすると必ず失敗するカード」を作らない（レビュー指摘）。
 * 非 `note.*` 軸が設定されたときの本格的な UX（ドラッグ無効化・ビュー全体の警告）は F4（#21）で扱う。
 * `getValue` が throw した軸は **absent 相当（undefined）＝配置は未分類**へ倒す（安全側）。
 */
function readSingleAxis(
  entry: BasesEntry,
  id: BasesPropertyId,
): boolean | undefined {
  if (toFrontmatterKey(id) === null) return undefined;
  const result = readAxisValueSafely(entry, id);
  return result.ok ? normalizeAxis(result.value) : undefined;
}

/** 1 エントリの両軸値を読み、absent を区別した {@link AxisValues} を返す。 */
export function readAxisValues(
  entry: BasesEntry,
  ids: AxisPropertyIds,
): AxisValues {
  return {
    urgent: readSingleAxis(entry, ids.urgent),
    important: readSingleAxis(entry, ids.important),
  };
}

/**
 * 値が「present だが boolean でない」（数値/文字列等）＝ドロップの両軸 `true/false` 上書きで
 * **破壊される**値かを判定する。`null`・absent（`NullValue`）は `false`（欠損は上書きで破壊せず、
 * 分類として新規に書けるため）。`BooleanValue` も `false`（boolean→boolean は再分類で破壊でない）。
 * `normalizeAxis`（値を undefined へ潰す）と違い、**absent と「非 boolean が入っている」を区別する**
 * ための述語（前者はドラッグ可・後者はドラッグ不可にする）。
 */
export function isUnsupportedAxisValue(value: Value | null): boolean {
  if (value == null) return false;
  if (value instanceof NullValue) return false; // absent（欠損）は破壊しない
  return !(value instanceof BooleanValue);
}

/** 書込可能な `note.*` 軸に限り、その軸値が非 boolean（破壊対象）かを見る。 */
function isUnsupportedOnWritableAxis(
  entry: BasesEntry,
  id: BasesPropertyId,
): boolean {
  // 非 note.*（formula/file）軸は書き戻し自体が `resolveWritableAxisKeys` で弾かれ破壊経路が無いため対象外。
  if (!isWritableAxisProperty(id)) return false;
  const result = readAxisValueSafely(entry, id);
  // getValue が throw した書込可能 note.* 軸は **安全側でロック**する（レビュー指摘 #2）。読み取り（getValue）と
  // 書き戻し（processFrontMatter）は別系統で、書き戻しは getValue を経由せず生 frontmatter を true/false 上書き
  // するため、値の型を boolean と確証できないままドラッグを許すと元の数値/文字列を破壊しうる。throw を absent と
  // 同一視して未ロック（ドラッグ可）にすると #34/#3 が塞いだ非 boolean 破壊経路を再開する。
  if (!result.ok) return true;
  return isUnsupportedAxisValue(result.value);
}

/**
 * エントリのどちらかの軸が「書込可能 `note.*` 上の非 boolean 値」を持つか（#34 で未分類化した
 * カードのうち、ドロップで両軸を `true/false` 上書きすると元の数値/文字列を破壊するもの）。
 *
 * `true` のカードは UI（`NoteCard`）で**未分類ゾーンでもドラッグ不可**にして誤ドロップによる
 * データ破壊を防ぐ（#34 が読み取り側で塞げなかった「未分類からの手動ドラッグ」経路の封鎖）。
 * 真に absent なカード（欠損）は `false`＝ドラッグして分類できる（破壊しない）ため区別する。
 */
export function hasUnsupportedAxisValue(
  entry: BasesEntry,
  ids: AxisPropertyIds,
): boolean {
  return (
    isUnsupportedOnWritableAxis(entry, ids.urgent) ||
    isUnsupportedOnWritableAxis(entry, ids.important)
  );
}
