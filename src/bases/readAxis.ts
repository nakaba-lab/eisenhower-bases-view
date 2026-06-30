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
 * 軸 propertyId から frontmatter の書き戻しキーを取り出す（#20 F3 のドラッグ書き戻し用）。
 * `note.<key>` のみ書き戻し可能で `<key>` を返す。`formula.*`／`file.*` 等は
 * frontmatter へ書き戻せないため `null` を返す（呼び出し側は Notice 等で弾く）。
 */
export function toFrontmatterKey(propertyId: BasesPropertyId): string | null {
  const raw = propertyId as unknown as string;
  if (!raw.startsWith(NOTE_PROPERTY_PREFIX)) return null;
  const key = raw.slice(NOTE_PROPERTY_PREFIX.length);
  return key.length > 0 ? key : null;
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
