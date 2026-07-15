/**
 * 数値しきい値軸のドラッグ書き戻しプラン（#122 v0.3-1b・純関数・単体 TDD 対象）。
 *
 * `writeBackAxes`（`EisenhowerBasesView`＝`extends BasesView` で単体対象外）から、越境判定・代表値決定・
 * 「書いた軸だけ」の集約という**判定純度**を切り出す（`resolveWritableAxisKeys`／`viewOptions` と同じ
 * 「純ラッパを切り出して単体で固定する」流儀）。`processFrontMatter` の plain `frontmatter` を受け、
 * 各軸を {@link frontmatterValueToAxisRaw} → {@link axisSpecForWrite} → `planAxisWrite`（#120）へ通し、
 * **書き込みが要る軸だけ** {@link AxisWrite}（`{key, value}`）で返す。返り値はそのまま `buildUndoEntries`
 *（#105 keylist）へ渡せる形にして、undo が「書いた軸だけ」を verbatim 復元・照合できるようにする。
 *
 * kind 決定は **案B（読み取り経路と対称）**（設計承認・2026-07-15 `AskUserQuestion`・`docs/design/bases.md`
 *「数値しきい値軸 書き戻し＋undo」節）: present 値は JS 型で kind を推論（#121 の「kind は値型推論」を
 * 書き込み側でも踏襲）、**absent のみ threshold の有無で解決**する（absent は型が無く、AC5 の代表値決定に
 * spec の kind が要るため）。これで「読み取りでは boolean 扱いで掴めるのに、書き込みで number spec に化けて
 * `planAxisWrite`→locked→`null` になりスナップバックする」非対称（案A の弱点）を作らない（データ安全最優先）。
 */
import { planAxisWrite, type AxisRaw, type AxisSpec } from "../logic/axis";
import type { AxisWrite, FrontmatterLike } from "../logic/undo";
import type { WritableAxisKeys } from "./readAxis";
import type { NumberThresholds } from "./numberThreshold";
import type { AxisWriteValues } from "./types";

/**
 * `processFrontMatter` の plain 値（frontmatter[key]）を純ロジック層の {@link AxisRaw} へ正規化する。
 *
 * 読み取り経路の `toAxisRaw`（Obsidian `Value`→`AxisRaw`）の**書き込み側の対**で、こちらは frontmatter の
 * 生 JS 値を振り分ける。キー欠損・`null`・`undefined` は **absent**（分類として新規に書ける＝破壊しない・
 * `0` や `false` と区別する）。`boolean`/`number`/`string`/配列はそのまま kind へ。想定外の値（object 等）は
 * `String(value)` で string へ倒す**防御 catch-all**（そうした値は読み取り側で locked＝ドラッグ不可のため
 * 通常この書き込み経路には到達しない）。
 */
export function frontmatterValueToAxisRaw(frontmatter: FrontmatterLike, key: string): AxisRaw {
  if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) return { kind: "absent" };
  const value = frontmatter[key];
  // null/undefined は「値が無い」＝absent（欠損）に倒す（新規分類で代表値を書ける）。
  if (value === null || value === undefined) return { kind: "absent" };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "string") return { kind: "string", value };
  if (Array.isArray(value)) return { kind: "array", value };
  // object 等の未対応型（読み取りで locked＝掴めないため通常到達しない）を string へ倒す防御既定。
  // string 値は下流で未使用（boolean spec は current 非依存／select・tag spec は 1b で生成しない）ため
  // 文字列内容は問わない。到達不能・値未使用の意図的 base-to-string（`[object Object]` 化）を許容する。
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- 防御既定・到達不能・stringify 結果は未使用
  return { kind: "string", value: String(value) };
}

/**
 * 書き戻し時の軸 {@link AxisSpec} を決める（案B＝読み取りと対称）。
 *
 * **threshold が設定済み（非 null）かつ現在値が number または absent** のとき number spec、それ以外は
 * boolean spec を返す。number 値は数値軸として越境/温存を、absent は AC5 の代表値書き込みを可能にする。
 * boolean 値・string 値・threshold 未設定（off-sentinel）は boolean spec に倒す（boolean 値は読み書き
 * 対称で boolean のまま扱い数値で上書きしない／off-sentinel・非対応型は読み取りロックで到達しない防御既定）。
 */
export function axisSpecForWrite(threshold: number | null, current: AxisRaw): AxisSpec {
  if (threshold !== null && (current.kind === "number" || current.kind === "absent")) {
    return { kind: "number", threshold };
  }
  return { kind: "boolean" };
}

/** 書き戻し対象の両軸（順序は undo 記録・テストの期待順に一致させるため固定）。 */
const AXES = ["urgent", "important"] as const;

/**
 * ドロップ先の目標両軸 side（`AxisWriteValues`）から、実際に frontmatter へ書く {@link AxisWrite} 群を組む。
 *
 * 各軸で「現在値→spec→`planAxisWrite`」を通し、**プランが `null`（既に目標側＝温存）でない軸だけ**を
 * `{key, value}` で集める。これにより:
 * - 数値軸は**越境時のみ代表値**を書き、同じ側なら書かない（連続値のニュアンスを温存・AC1/AC2）。
 * - absent の数値軸は両軸に代表値を書く（新規分類・AC5）。
 * - boolean 軸は `planAxisWrite` が `current` に依らず常に `{value: side}` を返すため**両軸を無条件に
 *   書き込む**（v1 挙動不変・AC4・回帰）。
 *
 * 返り値をそのまま `buildUndoEntries(frontmatter, writes)`（#105）に渡せば、undo は「書いた軸だけ」を
 * verbatim 前値で復元・照合できる（`writeBackAxes` が本結果で undo 記録を組み frontmatter へ適用する）。
 */
export function planWriteBack(
  frontmatter: FrontmatterLike,
  keys: WritableAxisKeys,
  sides: AxisWriteValues,
  thresholds: NumberThresholds,
): AxisWrite[] {
  const writes: AxisWrite[] = [];
  for (const axis of AXES) {
    const current = frontmatterValueToAxisRaw(frontmatter, keys[axis]);
    const spec = axisSpecForWrite(thresholds[axis], current);
    // 防御的深層防御（データ安全最優先）: boolean spec は boolean/absent 以外の present 値
    //（数値/文字列/配列/object）を上書きしない＝boolean で既存の非 boolean 値を潰さない。
    // 読み取り側ロック（#34/#121: 非 boolean note.* は掴めない）が主ガードだが、render↔write 間で
    // threshold が乖離（`config.get` の一過性 throw で write 時に `null` へフォールバック）したり、
    // in-flight レースで値が非 boolean に化けても、boolean 上書きによる silent なデータ変換
    //（数値→`true`/`false` 等）を起こさない（writeCompletion の非 boolean 保護と同じ思想を書き戻し側にも敷く）。
    // boolean/absent は正当な boolean 軸の書き込みなので通す（AC4 挙動不変）。number/select/tag spec の
    // 非対応値保護は planAxisWrite 側（locked→null）が担うため、本ガードは boolean spec に限定する。
    if (spec.kind === "boolean" && current.kind !== "boolean" && current.kind !== "absent") {
      continue;
    }
    const plan = planAxisWrite(sides[axis], spec, current);
    if (plan !== null) writes.push({ key: keys[axis], value: plan.value });
  }
  return writes;
}
