/**
 * readBadges — カード追加プロパティ表示（バッジ）の解決・読み取り・正規化（#104 F8・読み取り専用）。
 *
 * 書き戻し軸（`note.*` 限定＝{@link isWritableAxisProperty}）と違い、バッジは**読み取り専用の別サーフェス**
 * のため `formula.*`／`file.*` も選択できる。`entry.getValue` の Value を表示文字列へ正規化し、例外・absent は
 * 空文字へ退避してビュー全体を壊さない（`readAxisValueSafely`／`safeGetAsPropertyId` と同型の境界防御を
 * アダプタ層に隔離する）。`toString()` ベース＋型別分岐は最小限（churn 耐性）。
 *
 * `NullValue`（値）を obsidian から import するため（実機は外部提供・esbuild external）、単体テストは
 * vitest が obsidian の値 import を `src/test-support/obsidianStub.ts` へ解決する（`readAxis` と同じ流儀）。
 */
import { NullValue } from "obsidian";
import type { BasesEntry, BasesPropertyId, BasesViewConfig, Value } from "obsidian";
import type { EisenhowerSettings } from "../settings";
import { isEmphasizedDate } from "../logic/dateEmphasis";
import { logChurnFailureOnce, safeGetAsPropertyId } from "./readAxis";

/** カードに表示できるバッジの最大個数（カード密度への影響を抑える上限）。 */
export const MAX_BADGE_PROPERTIES = 3;

/** ビュー options のバッジプロパティキー（`badgeProperty1..N`）。`resolveBadgePropertyIds` が読む。 */
export const BADGE_OPTION_KEYS: readonly string[] = Array.from(
  { length: MAX_BADGE_PROPERTIES },
  (_unused, index) => `badgeProperty${index + 1}`,
);

/** カードに載せる 1 バッジの表示用データ（Bases 非依存の plain データ）。 */
export interface Badge {
  /** 表示ラベル（プロパティ名から名前空間接頭辞を落としたもの）。 */
  label: string;
  /** 正規化済み表示文字列（例外・absent は空文字へ退避）。 */
  text: string;
  /** 厳格 ISO 日付が今日以前 × 強調トグル on のときだけ true（AC4）。 */
  emphasized?: boolean;
}

/** バッジ読み取り時のオプション（日付強調の算出に使う）。 */
export interface ReadBadgesOptions {
  /** 今日の日付（ISO `YYYY-MM-DD`）。アダプタが注入する（`Date.now()` 非依存＝純度維持）。 */
  today: string;
  /** 期日らしい値（厳格 ISO・今日以前）をアクセント強調するか（既定オフ）。 */
  emphasizePastDates: boolean;
}

/** 既知の名前空間接頭辞（読み取り専用＝全サーフェス可）。 */
const NAMESPACE_PREFIXES = ["note.", "file.", "formula."] as const;

/**
 * propertyId から表示ラベルを導く。`note.`／`file.`／`formula.` の名前空間接頭辞を 1 つ落とし、
 * 残りをラベルにする（`note.due`→`due`）。名前空間の無い/未知の id はそのまま返す（防御）。
 */
export function badgeLabel(id: BasesPropertyId): string {
  const raw = id as unknown as string;
  if (typeof raw !== "string") return "";
  for (const prefix of NAMESPACE_PREFIXES) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return raw;
}

/**
 * 同一 propertyId の重複を除去する（順序は保つ）。同じプロパティを複数指定しても同じバッジが
 * 二重表示されず、最大 {@link MAX_BADGE_PROPERTIES} 個の表示枠を無駄に消費しない（レビュー指摘）。
 */
function dedupePropertyIds(ids: readonly BasesPropertyId[]): BasesPropertyId[] {
  const seen = new Set<string>();
  const result: BasesPropertyId[] = [];
  for (const id of ids) {
    const key = id as unknown as string;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(id);
  }
  return result;
}

/**
 * 表示するバッジプロパティ ID を解決する（#104 F8）。ビュー options（`badgeProperty1..N`）を主とし、
 * 1 つでも設定されていればそれを使う。未設定ならプラグイン設定 `cardBadgeProperties` をデフォルトに使う。
 * 読み取り専用サーフェスのため `note.*` に限定せず、`formula.*`／`file.*` も通す（軸の書き戻し制約とは別）。
 * 境界防御は `readAxis.safeGetAsPropertyId` を共有する（別実装で観測性が乖離しないため・レビュー指摘）。
 * 重複 propertyId は除去し（同じバッジの二重表示を防ぐ）、最大 {@link MAX_BADGE_PROPERTIES} 個で丸める。
 * 既定（options 無し・設定 `[]`）は空配列＝**表示 0 個**（カード密度は現状維持・AC3）。
 */
export function resolveBadgePropertyIds(
  config: Pick<BasesViewConfig, "getAsPropertyId"> | undefined | null,
  settings: EisenhowerSettings,
): BasesPropertyId[] {
  const fromOptions: BasesPropertyId[] = [];
  for (const key of BADGE_OPTION_KEYS) {
    const id = safeGetAsPropertyId(config, key);
    if (id != null) fromOptions.push(id);
  }
  // options が 1 つでもあればそれを、無ければ設定デフォルト（非文字列/空は mergeSettings が弾き済み）を使う。
  const source =
    fromOptions.length > 0
      ? fromOptions
      : settings.cardBadgeProperties.map((name) => name as BasesPropertyId);
  return dedupePropertyIds(source).slice(0, MAX_BADGE_PROPERTIES);
}

/**
 * 1 バッジの値を読み、表示文字列へ正規化する（`readAxis.readAxisValueSafely` と対称の境界防御）。
 *
 * **`getValue` だけでなく正規化の `toString()` まで**同じ try/catch で包む（churn した Bases の未知型で
 * `toString()` が throw しても、`readBadges.map`→`toViewModel`→`onDataUpdated` へ伝播してビュー全体を
 * 壊さないよう空文字へ退避する＝AC2）。`null`・absent（`NullValue`）は空文字（`NullValue.toString()` は
 * 文字列 "null" を返すため型で弾く）、それ以外は `toString()` で文字列化する（型別分岐は最小限＝churn 耐性）。
 */
const loggedBadgeReadFailures = new Set<string>();

function readBadgeText(entry: BasesEntry, id: BasesPropertyId): string {
  try {
    const value: Value | null = entry.getValue(id);
    if (value == null || value instanceof NullValue) return "";
    return value.toString();
  } catch (error) {
    // 姉妹の read パス（`readAxisValueSafely`）と対称に、churn した Bases の例外をキー単位で一度だけ
    // ログする（読み取り専用のため空文字退避は安全だが、全カード空表示が「本当に空」か「読み取り失敗」
    // かを区別できるよう診断を残す・レビュー指摘）。`toString()` の throw も同じ catch で拾う。
    const raw = id as unknown as string;
    logChurnFailureOnce(
      loggedBadgeReadFailures,
      typeof raw === "string" ? raw : String(raw),
      "badge getValue/toString failed; showing empty",
      error,
    );
    return "";
  }
}

/**
 * エントリの各バッジプロパティを読み、解決済みの {@link Badge} 配列を返す（#104 F8・AC1/AC2/AC4）。
 * プロパティ 1 つにつき 1 バッジを必ず返し（AC1 の件数）、例外・absent は `text:""` へ退避する（AC2）。
 * `emphasizePastDates` on かつ値が厳格 ISO 日付で今日以前なら `emphasized:true` を付ける（AC4）。
 */
export function readBadges(
  entry: BasesEntry,
  ids: readonly BasesPropertyId[],
  options: ReadBadgesOptions,
): Badge[] {
  return ids.map((id) => {
    const text = readBadgeText(entry, id);
    const badge: Badge = { label: badgeLabel(id), text };
    if (options.emphasizePastDates && isEmphasizedDate(text, options.today)) {
      badge.emphasized = true;
    }
    return badge;
  });
}
