/**
 * 軸の一般化（数値/選択/タグ軸）の純ロジック基盤（#120 F0・Obsidian 非依存・単体 TDD 対象）。
 *
 * v1 の boolean 固定軸を `AxisSpec`（boolean/number/select/tag）へ一般化する。churn しやすい
 * Bases API（Obsidian `Value` 型）への接触はアダプタ層（`src/bases`）に閉じ、本モジュールは
 * アダプタが `instanceof` で型正規化した {@link AxisRaw}（型タグ付き生値）と {@link AxisSpec} だけを
 * 受け取り、値の解釈（{@link interpretAxis}）と書き戻しプラン（{@link planAxisWrite}）を純関数で提供する。
 *
 * 象限ロジック（`classifyQuadrant`／`axisValuesForQuadrant`＝`quadrant.ts`）は不変に保ち、軸の側
 *（`boolean | undefined`）を安定インターフェースとして維持する。undo は #105 のキーリスト機構
 *（`AxisWrite {key, value: unknown}`＝`undo.ts`）を流用し、アダプタが {@link AxisWritePlan.value} に
 * 解決済みキーを付けて `UndoEntry` を組む（本モジュールは書き戻し先キーに非依存＝AxisSpec を Obsidian
 * 非依存に保つため）。
 *
 * 設計の真実源は `docs/design/bases.md`「AxisSpec 基盤」節（§3.3 再構成表）。
 */

/** 軸の解釈仕様（判定＋書き戻し方法を規定・Obsidian 非依存）。 */
export type AxisSpec =
  | { kind: "boolean" }
  | { kind: "number"; threshold: number; highValue?: number; lowValue?: number }
  | { kind: "select"; trueValue: string; falseValue: string }
  | { kind: "tag"; tag: string };

/**
 * 型正規化済みの生値。アダプタが Obsidian `Value` を `instanceof`（`BooleanValue`／`NumberValue`／
 * `StringValue`／`NullValue`／配列）で振り分けてこの判別共用体へ落とす。`absent` はプロパティ欠損。
 */
export type AxisRaw =
  | { kind: "absent" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "array"; value: readonly unknown[] };

/**
 * {@link interpretAxis} の結果。`side=undefined` は当該軸が未分類（象限に置けない）、`locked=true` は
 * present だが spec で解釈できない値＝ドラッグ不可（既存値をドラッグ上書きから保護）。
 */
export interface AxisReading {
  side: boolean | undefined;
  locked: boolean;
}

/** {@link planAxisWrite} の結果。書き込む値のプラン（書き戻し先キーはアダプタが付す）。 */
export interface AxisWritePlan {
  value: unknown;
}

/**
 * 型正規化済みの生値 {@link AxisRaw} を {@link AxisSpec} に照らして「軸の側」と「ロック」に解釈する。
 *
 * - `absent`（欠損）は全 kind で未分類・非ロック（何も無いので保護不要・ドロップで代表値を書ける）。
 * - 生値の型が spec と不一致（present だが解釈不能）なら未分類・**ロック**（既存値を保護）。
 * - number は有限数のみ `value >= threshold` で side を決める（**境界ちょうどは true 側**）。NaN・±Inf は
 *   非有限のため未分類・ロック。
 * - select は文字列が `trueValue`／`falseValue` に一致すれば side、どちらとも不一致（異物値）なら保護ロック。
 * - tag は配列に `tag` を含めば true・含まなければ false（非所属は false 側に確定・二値）。
 */
export function interpretAxis(raw: AxisRaw, spec: AxisSpec): AxisReading {
  if (raw.kind === "absent") return { side: undefined, locked: false };

  switch (spec.kind) {
    case "boolean":
      return raw.kind === "boolean"
        ? { side: raw.value, locked: false }
        : { side: undefined, locked: true };

    case "number":
      if (raw.kind !== "number" || !Number.isFinite(raw.value)) {
        return { side: undefined, locked: true };
      }
      return { side: raw.value >= spec.threshold, locked: false };

    case "select":
      if (raw.kind !== "string") return { side: undefined, locked: true };
      if (raw.value === spec.trueValue) return { side: true, locked: false };
      if (raw.value === spec.falseValue) return { side: false, locked: false };
      return { side: undefined, locked: true }; // 異物値は保護（決定#3）

    case "tag":
      if (raw.kind !== "array") return { side: undefined, locked: true };
      return { side: raw.value.includes(spec.tag), locked: false }; // 非所属は false（決定#4）
  }
}

/**
 * 目標の側（`side`）へ動かすための書き戻しプランを求める（既に目標側なら `null`＝書かずに値温存）。
 *
 * - boolean は AC7 の「挙動不変」のため、`current` に依らず**常に** `{value: side}` を書く（温存しない）。
 * - number/select/tag は {@link interpretAxis} の側が既に目標と一致すれば `null`（既存値を温存・AC4）。
 *   越境／absent（未分類）なら代表値を書く: number は `highValue ?? threshold`／`lowValue ?? threshold-1`、
 *   select は `trueValue`／`falseValue`、tag は現配列に `tag` を add／remove した**新配列**（他要素は温存・AC6）。
 *
 * 前提: 軸が locked でないときに呼ばれる（locked のカードは UI がドラッグを封じる）。
 */
export function planAxisWrite(
  side: boolean,
  spec: AxisSpec,
  current: AxisRaw,
): AxisWritePlan | null {
  // boolean は常に true/false を書く（挙動不変・AC7。非 boolean 値の保護は #34 の読み取り側/UI で担保）。
  if (spec.kind === "boolean") return { value: side };

  const reading = interpretAxis(current, spec);
  // present だが spec で解釈できない値（locked）は上書きしない＝既存値を保護する（決定#3・#34 の一般化）。
  // 通常 locked のカードは UI がドラッグを封じるが、基盤モジュール自身も破壊を拒む（防御的深層防御）。
  if (reading.locked) return null;
  // 既に目標側なら書かない＝既存値を温存する（AC4）。
  if (reading.side === side) return null;

  switch (spec.kind) {
    case "number":
      return {
        value: side
          ? (spec.highValue ?? spec.threshold)
          : (spec.lowValue ?? spec.threshold - 1),
      };

    case "select":
      return { value: side ? spec.trueValue : spec.falseValue };

    case "tag": {
      const currentTags = current.kind === "array" ? current.value : [];
      const withoutTag = currentTags.filter((tag) => tag !== spec.tag);
      return { value: side ? [...withoutTag, spec.tag] : withoutTag };
    }
  }
}
