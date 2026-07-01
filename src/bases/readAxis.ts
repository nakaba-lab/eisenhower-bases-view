/**
 * 軸プロパティの解決と、1 軸値の absent/true/false 正規化（#19 F2・#33 で absent 判定を是正）。
 *
 * Bases API 接触（`config.getAsPropertyId`／`entry.getValue`）をアダプタ層に閉じ込める。
 * absent 判定は実機検証（#33・`scripts/e2e` プローブ）で確定した NullValue の**型同一性**で行う:
 * 欠損プロパティの `getValue` は **NullValue（singleton）** を返すため `value instanceof NullValue`
 * で absent を検出し、明示 `false`（BooleanValue）と区別する（`isTruthy()` だけでは absent と false を
 * 区別できず欠損ノートを最低象限 Delete に誤分類する）。
 *
 * 旧実装は `toString()===null` で判定していたが、実機の `NullValue.toString()` は文字列 "null" を
 * 返す（型契約どおり string）ため機能せず、absent が false に誤判定されていた（スパイク #16 の誤観測）。
 * 型同一性（instanceof）は constructor 名が minify されても（実機は `"t"`）成立し、文字列表現に依存しない。
 *
 * NullValue（値）は obsidian から import する（実機は外部提供・esbuild external）。型は `import type`、
 * 単体テストは vitest が obsidian の値 import を `src/test-support/obsidianStub.ts` へ解決する。
 */
import { NullValue } from "obsidian";
import type { BasesEntry, BasesPropertyId, BasesViewConfig, Value } from "obsidian";
import type { EisenhowerSettings } from "../settings";
import type { AxisValues } from "../logic/quadrant";

/**
 * Bases ビュー options のキー。F4（#21）の軸プロパティ設定 UI がこのキーに書き込み、
 * 本層は `config.getAsPropertyId(key)` で解決する。
 */
export const URGENT_OPTION_KEY = "urgentProperty";
export const IMPORTANT_OPTION_KEY = "importantProperty";

/** 解決済みの両軸 propertyId。 */
export interface AxisPropertyIds {
  urgent: BasesPropertyId;
  important: BasesPropertyId;
}

/** 設定のプロパティ名（例: "urgent"）を note プロパティ ID（`note.urgent`）にする。 */
function toNotePropertyId(name: string): BasesPropertyId {
  return `note.${name}` as BasesPropertyId;
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
 * 軸 propertyId を解決する。ビュー options（`config.getAsPropertyId`）を主とし、
 * 未設定（null）なら設定タブのデフォルト（`note.<name>`）にフォールバックする（要件 F4）。
 */
export function resolveAxisPropertyIds(
  config: Pick<BasesViewConfig, "getAsPropertyId"> | undefined | null,
  settings: EisenhowerSettings,
): AxisPropertyIds {
  const urgent =
    config?.getAsPropertyId(URGENT_OPTION_KEY) ??
    toNotePropertyId(settings.defaultUrgencyProperty);
  const important =
    config?.getAsPropertyId(IMPORTANT_OPTION_KEY) ??
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
  return { urgent, important };
}

/**
 * 1 軸の Value を boolean | undefined に正規化する。
 * absent（NullValue singleton）と `getValue` 自体の null を undefined にし、
 * 値があれば `isTruthy()` で boolean 化する（absent 判定は `instanceof NullValue`＝型同一性）。
 */
function normalizeAxis(value: Value | null): boolean | undefined {
  if (value == null) return undefined; // getValue 自体の null（防御）
  if (value instanceof NullValue) return undefined; // absent（NullValue singleton）
  return value.isTruthy();
}

/**
 * 1 軸を読む。書き戻し可能な `note.*` 以外（`formula.*`／`file.*`）は **absent 扱い（undefined）**にして
 * 4 象限へ配置しない（未分類・ドロップ不可）。読み取り側を書き戻し側（{@link toFrontmatterKey}）と
 * 対称にし、「4 象限に並ぶのにドラッグすると必ず失敗するカード」を作らない（レビュー指摘）。
 * 非 `note.*` 軸が設定されたときの本格的な UX（ドラッグ無効化・ビュー全体の警告）は F4（#21）で扱う。
 */
function readSingleAxis(
  entry: BasesEntry,
  id: BasesPropertyId,
): boolean | undefined {
  if (toFrontmatterKey(id) === null) return undefined;
  return normalizeAxis(entry.getValue(id));
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
