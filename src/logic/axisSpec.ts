/**
 * 軸タイプの一般化（v0.3・#120 F0）の純ロジック基盤（Obsidian 非依存・単体 TDD の対象）。
 *
 * v1/v0.2 は boolean 軸限定だったが、v0.3 で数値/選択/タグ軸へ一般化する。象限ロジック
 *（{@link ../logic/quadrant} の `classifyQuadrant`／`axisValuesForQuadrant`）は**一切変えず**、
 * 本モジュールは軸解釈の 2 つの端だけを一般化する:
 *
 *   [Value 生値] --interpretAxis(raw, spec)--> [side: boolean|undefined] --classifyQuadrant--> [象限]
 *   [象限] --axisValuesForQuadrant--> [side: boolean] --planAxisWrite(side, spec, current)--> [書き込み or 書かない]
 *
 * `boolean | undefined`（軸の側・未分類）が軸解釈と象限判定の安定インターフェースで、この不変性が
 * 「boolean 軸は挙動不変」を保証し、Bases API churn を読み取り端（アダプタの Value→AxisRaw 変換）に閉じ込める。
 *
 * Value の実表現・instanceof 判別・公開 API での取り出しはアダプタ層（`src/bases/readAxis.ts`＝1a/2/3b）が
 * {@link AxisRaw} へ正規化して本モジュールへ渡す（本モジュールは Value 型に非依存＝S0 スパイク非依存で TDD できる）。
 * 設計は docs/superpowers/specs/2026-07-11-axis-generalization-v0.3-design.md §3。
 */

/**
 * 軸ごとの仕様。指定はハイブリッド（ビュー options 主・プラグイン設定デフォルト）でアダプタが解決して渡す。
 * - number: `value >= threshold` を true 側。越境書き込みの代表値は `highValue`（既定 threshold）/
 *   `lowValue`（既定 threshold-1）。
 * - select: 文字列の完全一致（`trueValue`/`falseValue` の 2 値。未知値は未分類＋locked）。
 * - tag: frontmatter リストへの `tagName` 包含。
 */
export type AxisSpec =
  | { kind: "boolean" }
  | { kind: "number"; threshold: number; highValue?: number; lowValue?: number }
  | { kind: "select"; trueValue: string; falseValue: string }
  | { kind: "tag"; tagName: string };

/**
 * アダプタが Value を正規化した型付き生値。判別（instanceof）と取り出し（公開 API）はアダプタが担い、
 * 本モジュールは正規化済みの値だけを見る（Value 型非依存）。
 * - `list`: タグ等のリスト。要素は文字列（アダプタが `#` 付き/bare どちらで渡してもよい＝下記 {@link normalizeTag} が吸収）。
 * - `unsupported`: `getValue` の throw・`ErrorValue`・未知型（型を確証できない＝安全側ロック）。
 */
export type AxisRaw =
  | { kind: "absent" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "list"; values: string[] }
  | { kind: "unsupported" };

/** {@link interpretAxis} の結果。`side` は象限側（`undefined`＝未分類）、`locked` は破壊防止のドラッグ不可。 */
export interface AxisInterpretation {
  /** 軸の側（`classifyQuadrant` に渡す `boolean | undefined`）。 */
  side: boolean | undefined;
  /** present だが spec で解釈不能でドラッグ→書き込みが破壊になる値か（true=ドラッグ不可）。 */
  locked: boolean;
}

/** {@link planAxisWrite} の結果。書き込む値を持つ（tag は配列）。`null`（返り値）＝書かない（値温存）。 */
export interface AxisWritePlan {
  /** frontmatter へ書き込む値（number/select/boolean は primitive、tag は新しい配列）。 */
  value: unknown;
}

/** 未分類・ドラッグ可（欠損は新規分類できるので locked にしない）。 */
const ABSENT: AxisInterpretation = { side: undefined, locked: false };
/** 未分類・安全側ロック（型を確証できない present 値＝ドラッグ→書き込みで破壊しうる）。 */
const UNSUPPORTED: AxisInterpretation = { side: undefined, locked: true };

/**
 * タグ比較の正規化: 先頭 `#`（Value 層は `#urgent` 形）を外し小文字化する。アダプタが bare（`urgent`）で
 * 渡しても Value 層由来（`#Urgent`）で渡しても同一視できるようにし、3b の `#`/大小差吸収を logic 層で担保する。
 */
function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase();
}

function tagListIncludes(values: readonly string[], tagName: string): boolean {
  const target = normalizeTag(tagName);
  return values.some((v) => normalizeTag(v) === target);
}

/**
 * 型付き生値（{@link AxisRaw}）と軸仕様（{@link AxisSpec}）から、軸の側（`boolean | undefined`）と
 * locked を求める純関数。`absent` は全 spec で未分類・ドラッグ可、`unsupported` は全 spec で未分類・
 * 安全側ロック。present 値は spec の kind に照らして解釈し、解釈できない present 値は locked にして
 * ドラッグ→両軸書き込みによる元値破壊（#34）を防ぐ。
 */
export function interpretAxis(raw: AxisRaw, spec: AxisSpec): AxisInterpretation {
  if (raw.kind === "absent") return ABSENT;
  if (raw.kind === "unsupported") return UNSUPPORTED;

  switch (spec.kind) {
    case "boolean":
      return raw.kind === "boolean" ? { side: raw.value, locked: false } : UNSUPPORTED;

    case "number":
      if (raw.kind !== "number") return UNSUPPORTED;
      // NaN・±Infinity は閾値比較が無意味＝安全側ロック（false 側に落として上書きしない）。
      if (!Number.isFinite(raw.value)) return UNSUPPORTED;
      return { side: raw.value >= spec.threshold, locked: false };

    case "select":
      if (raw.kind !== "string") return UNSUPPORTED;
      if (raw.value === spec.trueValue) return { side: true, locked: false };
      if (raw.value === spec.falseValue) return { side: false, locked: false };
      // 未知値（3 値目 medium 等）は未分類＋locked＝書き潰さない。
      return UNSUPPORTED;

    case "tag":
      // タグ軸はリストのみ present として扱う（非リストは型不一致で locked）。
      // list present ならタグ包含で side（含む=true／含まない=false）。欠損（absent）は上で処理済み。
      return raw.kind === "list"
        ? { side: tagListIncludes(raw.values, spec.tagName), locked: false }
        : UNSUPPORTED;
  }
}

/**
 * 目標の側（`axisValuesForQuadrant` が返す side）× 軸仕様 × 現在値から、frontmatter へ何を書くかの
 * プランを求める純関数。`null`＝書かない（値温存）。
 *
 * - boolean: 常に `true`/`false` を書く（**挙動不変**・v1/v0.2 の両軸明示書き込みを維持）。
 * - number: 現在が既に目標の側なら書かない（連続値のニュアンスを温存）。越境／absent なら代表値
 *   （`highValue ?? threshold` / `lowValue ?? threshold-1`）を書く。
 * - select: 現在が既に目標値なら書かない。越境／absent なら `trueValue`/`falseValue` を書く。
 * - tag: side=true なら `tagName` を配列へ追加（既に含むなら書かない）、side=false なら除去
 *   （含まないなら書かない）。**他要素は温存**（全置換しない）。
 *
 * tag の `current` は frontmatter のタグ配列（アダプタが渡す）。他要素を verbatim に保ち、追加時は bare
 * `tagName` を末尾に足す。
 */
export function planAxisWrite(
  side: boolean,
  spec: AxisSpec,
  current: AxisRaw,
): AxisWritePlan | null {
  switch (spec.kind) {
    case "boolean":
      // 挙動不変: 現在値に依らず常に両軸へ明示 true/false を書く。
      return { value: side };

    case "number": {
      const currentSide =
        current.kind === "number" && Number.isFinite(current.value)
          ? current.value >= spec.threshold
          : undefined;
      if (currentSide === side) return null; // 既に目標の側＝値温存
      const high = spec.highValue ?? spec.threshold;
      const low = spec.lowValue ?? spec.threshold - 1;
      return { value: side ? high : low };
    }

    case "select": {
      const target = side ? spec.trueValue : spec.falseValue;
      if (current.kind === "string" && current.value === target) return null;
      return { value: target };
    }

    case "tag": {
      const values = current.kind === "list" ? current.values : [];
      const present = tagListIncludes(values, spec.tagName);
      if (side) {
        // 追加: 既に含むなら書かない。含まなければ他要素温存で末尾に bare tagName を足す。
        return present ? null : { value: [...values, spec.tagName] };
      }
      // 除去: 含まなければ書かない。含めば tagName のみ除去し他要素温存。
      if (!present) return null;
      const target = normalizeTag(spec.tagName);
      return { value: values.filter((v) => normalizeTag(v) !== target) };
    }
  }
}
