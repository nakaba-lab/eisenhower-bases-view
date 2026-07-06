import { describe, expect, it } from "vitest";
import type { BasesEntry, BasesPropertyId, BasesViewConfig, Value } from "obsidian";
import { BooleanValue, NullValue, NumberValue, StringValue } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import {
  IMPORTANT_OPTION_KEY,
  URGENT_OPTION_KEY,
  axesShareWritableKey,
  hasUnsupportedAxisValue,
  isUnsupportedAxisValue,
  readAxisValues,
  resolveAxisPropertyIds,
  resolveWritableAxisKeys,
  toFrontmatterKey,
  type AxisPropertyIds,
} from "./readAxis";

/**
 * readAxis — 軸プロパティの解決（config 主・settings デフォルト）と、
 * 1 軸値の absent/非 boolean/true/false 正規化。
 * v1 は **boolean 軸限定**のため、値が `BooleanValue` の軸だけを 4 象限に分類し、
 * 非 boolean（`NumberValue`/`StringValue`）や absent（`NullValue`）は未分類（undefined）へ
 * 退避する（#34。正の許可リスト `instanceof BooleanValue`）。obsidian の値 import
 * （`BooleanValue`/`NullValue`/…）は vitest が `src/test-support/obsidianStub.ts` へ解決する。
 */

/**
 * absent を表す **実 NullValue**（singleton）。実機の absent は NullValue で、
 * `toString()` は**文字列 "null"**・`isTruthy()===false`（`scripts/e2e` のプローブで確定）。
 * 判定は `toString()` の文字列ではなく `instanceof NullValue`（型同一性）で行うため、
 * 旧モック（`toString()===null` を返す素オブジェクト）ではなく実 NullValue を使う。
 */
const ABSENT: Value = NullValue.value;
/**
 * boolean 軸の値（実 `BooleanValue`）。#34 で正規化を boolean 軸限定に狭めたため、
 * true/false は素オブジェクトではなく **`instanceof BooleanValue` が成立する実インスタンス**を使う
 * （素オブジェクトは非 boolean 扱いで未分類化される＝実機の非 boolean 軸と同じ挙動）。
 */
const TRUE: Value = new BooleanValue(true);
const FALSE: Value = new BooleanValue(false);

function mockEntry(values: Record<string, Value | null>): BasesEntry {
  return {
    file: { path: "Tasks/a.md", basename: "a" },
    getValue: (id: BasesPropertyId) => values[id] ?? null,
  } as unknown as BasesEntry;
}

function mockConfig(
  map: Record<string, BasesPropertyId | null>,
): Pick<BasesViewConfig, "getAsPropertyId"> {
  return { getAsPropertyId: (key: string) => map[key] ?? null };
}

describe("resolveAxisPropertyIds", () => {
  it("resolveAxisPropertyIds — config 未設定なら settings デフォルトを note.<name> で使う", () => {
    // given / when
    const ids = resolveAxisPropertyIds(null, DEFAULT_SETTINGS);
    // then
    expect(ids).toEqual({
      urgent: "note.urgent",
      important: "note.important",
    });
  });

  it("resolveAxisPropertyIds — config のビュー options を主に使う（settings より優先）", () => {
    // given
    const config = mockConfig({
      [URGENT_OPTION_KEY]: "note.due" as BasesPropertyId,
      [IMPORTANT_OPTION_KEY]: "note.priority" as BasesPropertyId,
    });
    // when
    const ids = resolveAxisPropertyIds(config, DEFAULT_SETTINGS);
    // then
    expect(ids).toEqual({ urgent: "note.due", important: "note.priority" });
  });

  it("resolveAxisPropertyIds — 片方だけ config 設定なら他方は settings デフォルト", () => {
    // given
    const config = mockConfig({
      [URGENT_OPTION_KEY]: "note.due" as BasesPropertyId,
      [IMPORTANT_OPTION_KEY]: null,
    });
    // when
    const ids = resolveAxisPropertyIds(config, DEFAULT_SETTINGS);
    // then
    expect(ids).toEqual({ urgent: "note.due", important: "note.important" });
  });

  it("resolveAxisPropertyIds — getAsPropertyId が throw しても settings デフォルトで解決を続ける（Bases churn 防御・レビュー指摘 #3）", () => {
    // given: config.getAsPropertyId が例外を投げる（API 破壊的変更・内部不整合を模す）
    const config = {
      getAsPropertyId: () => {
        throw new Error("boom (getAsPropertyId churn)");
      },
    } as unknown as Pick<BasesViewConfig, "getAsPropertyId">;
    // when / then: 例外を伝播せず（toViewModel→onDataUpdated の全体崩壊を防ぐ）、既定軸 note.<name> へフォールバック
    let ids!: AxisPropertyIds;
    expect(() => {
      ids = resolveAxisPropertyIds(config, DEFAULT_SETTINGS);
    }).not.toThrow();
    expect(ids).toEqual({ urgent: "note.urgent", important: "note.important" });
  });
});

describe("readAxisValues", () => {
  const ids: AxisPropertyIds = {
    urgent: "note.urgent" as BasesPropertyId,
    important: "note.important" as BasesPropertyId,
  };

  it("readAxisValues — true/false をそのまま boolean に正規化する", () => {
    // given
    const entry = mockEntry({ "note.urgent": TRUE, "note.important": FALSE });
    // when
    const axis = readAxisValues(entry, ids);
    // then
    expect(axis).toEqual({ urgent: true, important: false });
  });

  it("readAxisValues — absent(NullValue・instanceof で判定) は undefined（false と区別）", () => {
    // given
    const entry = mockEntry({ "note.urgent": ABSENT, "note.important": FALSE });
    // when
    const axis = readAxisValues(entry, ids);
    // then
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(false);
  });

  it("readAxisValues — getValue が null を返す欠損も undefined（防御）", () => {
    // given
    const entry = mockEntry({ "note.urgent": null, "note.important": TRUE });
    // when
    const axis = readAxisValues(entry, ids);
    // then
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(true);
  });

  it("readAxisValues — getValue が throw しても当該軸だけ undefined へ退避し全体を壊さない（Bases churn 防御・レビュー指摘 #3）", () => {
    // given: 緊急軸の getValue が throw（未対応プロパティ型・API churn を模す）、重要軸は正常な boolean
    const entry = {
      file: { path: "Tasks/a.md", basename: "a" },
      getValue: (id: BasesPropertyId) => {
        if (id === "note.urgent") throw new Error("boom (unsupported property type)");
        return TRUE;
      },
    } as unknown as BasesEntry;
    // when / then: throw した軸は undefined（未分類扱い）へ落ち、もう片方は正常に読める（ビュー全体は壊れない）
    let axis!: ReturnType<typeof readAxisValues>;
    expect(() => {
      axis = readAxisValues(entry, ids);
    }).not.toThrow();
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(true);
  });

  it("readAxisValues — note.* 以外（formula/file）の軸は値があっても undefined＝未分類化（読み書き対称・レビュー指摘）", () => {
    // given: 緊急軸を書き戻し不可な formula.* に、重要軸を note.* に設定
    const mixedIds: AxisPropertyIds = {
      urgent: "formula.score" as BasesPropertyId,
      important: "note.important" as BasesPropertyId,
    };
    const entry = mockEntry({ "formula.score": TRUE, "note.important": TRUE });
    // when
    const axis = readAxisValues(entry, mixedIds);
    // then: formula 軸は getValue が真値でも absent 扱い → 4 象限に並べず未分類（ドラッグ→必ず失敗を防ぐ）
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(true);
  });

  it("readAxisValues — 数値軸（NumberValue・note.priority: 3 相当）は値があっても undefined＝未分類化（v1 boolean 軸限定・#34 AC1）", () => {
    // given: 緊急軸が数値プロパティ（note.priority: 3）、重要軸は boolean
    const entry = mockEntry({
      "note.urgent": new NumberValue(3),
      "note.important": TRUE,
    });
    // when
    const axis = readAxisValues(entry, ids);
    // then: 非 boolean は BooleanValue でないため未分類へ退避（ドラッグ→両軸 true/false 上書きでの数値破壊を防ぐ）
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(true);
  });

  it("readAxisValues — 文字列軸（StringValue）は値があっても undefined＝未分類化（#34 AC2）", () => {
    // given: 緊急軸が文字列プロパティ、重要軸は boolean
    const entry = mockEntry({
      "note.urgent": new StringValue("high"),
      "note.important": FALSE,
    });
    // when
    const axis = readAxisValues(entry, ids);
    // then
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBe(false);
  });

  it("readAxisValues — boolean 軸（BooleanValue）は従来どおり true/false に正規化される（#34 AC3・回帰防止）", () => {
    // given
    const entry = mockEntry({ "note.urgent": TRUE, "note.important": FALSE });
    // when / then: BooleanValue は isTruthy() で boolean 化（回帰なし）
    expect(readAxisValues(entry, ids)).toEqual({ urgent: true, important: false });
  });

  it("readAxisValues — 非 boolean は isTruthy の真偽ではなく型で退避する（falsy な NumberValue(0)/空文字も未分類・#34 AC4）", () => {
    // given: falsy な非 boolean（0・空文字）。isTruthy() ベースなら false（Delete 象限）に落ちうるが、
    //        型ガード（instanceof BooleanValue）なら型で undefined（未分類）へ退避されるべき
    const entry = mockEntry({
      "note.urgent": new NumberValue(0),
      "note.important": new StringValue(""),
    });
    // when
    const axis = readAxisValues(entry, ids);
    // then: どちらも undefined（未分類）。false（Delete）に誤分類しない
    expect(axis.urgent).toBeUndefined();
    expect(axis.important).toBeUndefined();
  });
});

describe("isUnsupportedAxisValue / hasUnsupportedAxisValue（非 boolean 上書き破壊の検出・ドラッグ不可ガード）", () => {
  const ids: AxisPropertyIds = {
    urgent: "note.urgent" as BasesPropertyId,
    important: "note.important" as BasesPropertyId,
  };

  it("isUnsupportedAxisValue — present な非 boolean（数値/文字列）は true（上書きで破壊される）", () => {
    expect(isUnsupportedAxisValue(new NumberValue(3))).toBe(true);
    expect(isUnsupportedAxisValue(new StringValue("high"))).toBe(true);
    // falsy な非 boolean（0/空文字）も型で判定する（true）
    expect(isUnsupportedAxisValue(new NumberValue(0))).toBe(true);
    expect(isUnsupportedAxisValue(new StringValue(""))).toBe(true);
  });

  it("isUnsupportedAxisValue — boolean・absent・null は false（上書きで破壊しない）", () => {
    expect(isUnsupportedAxisValue(TRUE)).toBe(false);
    expect(isUnsupportedAxisValue(FALSE)).toBe(false);
    expect(isUnsupportedAxisValue(ABSENT)).toBe(false); // NullValue=欠損は分類として書ける
    expect(isUnsupportedAxisValue(null)).toBe(false);
  });

  it("hasUnsupportedAxisValue — urgent 軸が非 boolean 値を持てば true（|| 第1オペランド）", () => {
    // given: 緊急軸が数値、重要軸は boolean
    const entry = mockEntry({
      "note.urgent": new NumberValue(3),
      "note.important": TRUE,
    });
    // when / then: ドロップで両軸 true/false 上書き→数値破壊のため、ドラッグ不可にすべき
    expect(hasUnsupportedAxisValue(entry, ids)).toBe(true);
  });

  it("hasUnsupportedAxisValue — important 軸だけが非 boolean でも true（|| 第2オペランド・破壊ガードの対称性）", () => {
    // given: 緊急軸は boolean（false）＝ || が短絡せず important を評価する。重要軸が数値。
    expect(
      hasUnsupportedAxisValue(
        mockEntry({ "note.urgent": FALSE, "note.important": new NumberValue(3) }),
        ids,
      ),
    ).toBe(true);
    // given: 緊急軸 absent（false 相当で短絡しない）＋重要軸が文字列でも true
    expect(
      hasUnsupportedAxisValue(
        mockEntry({ "note.urgent": ABSENT, "note.important": new StringValue("high") }),
        ids,
      ),
    ).toBe(true);
  });

  it("hasUnsupportedAxisValue — 両軸 boolean / 両軸 absent は false（通常のドラッグ対象）", () => {
    expect(
      hasUnsupportedAxisValue(
        mockEntry({ "note.urgent": TRUE, "note.important": FALSE }),
        ids,
      ),
    ).toBe(false);
    // 両軸 absent（＝分類として書ける・破壊しない）は false
    expect(
      hasUnsupportedAxisValue(
        mockEntry({ "note.urgent": ABSENT, "note.important": ABSENT }),
        ids,
      ),
    ).toBe(false);
  });

  it("hasUnsupportedAxisValue — 書込可能 note.* 軸の getValue が throw したら安全側で true＝ロックする（データ破壊防止・レビュー指摘 #2）", () => {
    // given: 書込可能 note.* 軸の getValue が throw（churn を模す）。読み取り（getValue）と書き戻し
    // （processFrontMatter）は別系統で、書き戻しは getValue を経由せず生 frontmatter を true/false 上書きする。
    const entry = {
      file: { path: "Tasks/a.md", basename: "a" },
      getValue: (): Value => {
        throw new Error("boom");
      },
    } as unknown as BasesEntry;
    // when / then: 例外は飲み込む（throw を伝播しない＝ビュー全体を壊さない）が、値の型を boolean と確証
    // できないため安全側で true（ロック）＝ドラッグ不可にして非 boolean 値の上書き破壊を防ぐ
    expect(() => hasUnsupportedAxisValue(entry, ids)).not.toThrow();
    expect(hasUnsupportedAxisValue(entry, ids)).toBe(true);
  });

  it("hasUnsupportedAxisValue — 非 note.*（formula/file）軸の非 boolean 値は対象外（書き込み自体が弾かれ破壊しない）", () => {
    // given: formula.* 軸に文字列。書き戻しは resolveWritableAxisKeys が null で弾くため破壊経路が無い
    const mixedIds: AxisPropertyIds = {
      urgent: "formula.score" as BasesPropertyId,
      important: "note.important" as BasesPropertyId,
    };
    const entry = mockEntry({
      "formula.score": new StringValue("x"),
      "note.important": TRUE,
    });
    // when / then: formula 軸は書込不可なのでロック対象にしない（ドラッグ→Notice で弾かれる既存経路に委ねる）
    expect(hasUnsupportedAxisValue(entry, mixedIds)).toBe(false);
  });
});

describe("toFrontmatterKey", () => {
  it("toFrontmatterKey — note.<key> から frontmatter キーを取り出す（書き戻し用・#20）", () => {
    // given / when / then
    expect(toFrontmatterKey("note.urgent" as BasesPropertyId)).toBe("urgent");
    expect(toFrontmatterKey("note.due_date" as BasesPropertyId)).toBe("due_date");
  });

  it("toFrontmatterKey — note. 接頭辞でない（formula./file.）は null＝書き戻し不可", () => {
    // given / when / then
    expect(toFrontmatterKey("formula.score" as BasesPropertyId)).toBeNull();
    expect(toFrontmatterKey("file.name" as BasesPropertyId)).toBeNull();
  });

  it("toFrontmatterKey — 空キー（bare 'note.'）は null＝空名で frontmatter を壊さない（レビュー指摘）", () => {
    // given / when / then: note. の後ろが空なら書き戻しキーにできない
    expect(toFrontmatterKey("note." as BasesPropertyId)).toBeNull();
  });

  it("toFrontmatterKey — frontmatter プロパティ名が 'note.x' のケース（propertyId=note.note.x）は 'note.x' を返す（入れ子は意図的に許可）", () => {
    // given / when / then: BasesPropertyId=`${type}.${name}` のため name に "note.x" を持つと
    // propertyId は "note.note.x"。書き戻し先 frontmatter キーは "note.x" が正しい（弾かない）。
    expect(toFrontmatterKey("note.note.x" as BasesPropertyId)).toBe("note.x");
  });
});

describe("resolveWritableAxisKeys（#21 F4・AC3 書き戻しガードの純度）", () => {
  it("resolveWritableAxisKeys — 両軸とも note.* なら frontmatter キーを返す（config 優先）", () => {
    // given
    const config = mockConfig({
      [URGENT_OPTION_KEY]: "note.due" as BasesPropertyId,
      [IMPORTANT_OPTION_KEY]: "note.priority" as BasesPropertyId,
    });
    // when / then
    expect(resolveWritableAxisKeys(config, DEFAULT_SETTINGS)).toEqual({
      urgent: "due",
      important: "priority",
    });
  });

  it("resolveWritableAxisKeys — config 未設定なら settings デフォルト（note.urgent/important）のキー", () => {
    // given / when / then
    expect(resolveWritableAxisKeys(null, DEFAULT_SETTINGS)).toEqual({
      urgent: "urgent",
      important: "important",
    });
  });

  it("resolveWritableAxisKeys — 片軸が formula.* なら null＝書き戻し前に弾く（AC3・frontmatter を壊さない）", () => {
    // given: 緊急軸を書き戻し不可な formula.* に設定
    const config = mockConfig({
      [URGENT_OPTION_KEY]: "formula.score" as BasesPropertyId,
      [IMPORTANT_OPTION_KEY]: "note.important" as BasesPropertyId,
    });
    // when / then: null → writeBackAxes は processFrontMatter を呼ばず Notice で reject する
    expect(resolveWritableAxisKeys(config, DEFAULT_SETTINGS)).toBeNull();
  });

  it("resolveWritableAxisKeys — 片軸が file.* でも null（両軸書込可でなければ弾く）", () => {
    // given
    const config = mockConfig({
      [URGENT_OPTION_KEY]: "note.urgent" as BasesPropertyId,
      [IMPORTANT_OPTION_KEY]: "file.name" as BasesPropertyId,
    });
    // when / then
    expect(resolveWritableAxisKeys(config, DEFAULT_SETTINGS)).toBeNull();
  });

  it("resolveWritableAxisKeys — 両軸が同一 note.* プロパティなら null（自己上書きで象限が飛ぶのを弾く・question 対応）", () => {
    // given: 緊急・重要の両方に同じ note.foo を割り当てた設定ミス
    const config = mockConfig({
      [URGENT_OPTION_KEY]: "note.foo" as BasesPropertyId,
      [IMPORTANT_OPTION_KEY]: "note.foo" as BasesPropertyId,
    });
    // when / then: 書き戻すと同一キーを 2 度書いて後勝ちで潰れるため、書き込み前に null で弾く（Notice）
    expect(resolveWritableAxisKeys(config, DEFAULT_SETTINGS)).toBeNull();
  });
});

describe("axesShareWritableKey（両軸同一キーの読み取り側検出＝掴めるのに必ず失敗する状態の封鎖）", () => {
  it("axesShareWritableKey — 両軸が同一 note.* キーなら true（全カードをドラッグ不可にする合図）", () => {
    // given: 緊急・重要に同じ note.foo（設定ミス）
    const ids = resolveAxisPropertyIds(
      mockConfig({
        [URGENT_OPTION_KEY]: "note.foo" as BasesPropertyId,
        [IMPORTANT_OPTION_KEY]: "note.foo" as BasesPropertyId,
      }),
      DEFAULT_SETTINGS,
    );
    // when / then
    expect(axesShareWritableKey(ids)).toBe(true);
  });

  it("axesShareWritableKey — settings デフォルト駆動（config 未設定）でも同一キーを検出する", () => {
    // given: config 無し・両軸デフォルトが同じプロパティ名の設定ミス
    const ids = resolveAxisPropertyIds(null, {
      ...DEFAULT_SETTINGS,
      defaultUrgencyProperty: "same",
      defaultImportanceProperty: "same",
    });
    // when / then: config 経路だけでなく settings フォールバック経路でも検出する
    expect(axesShareWritableKey(ids)).toBe(true);
  });

  it("axesShareWritableKey — 別々の note.* キーなら false（正常設定）", () => {
    const ids = resolveAxisPropertyIds(
      mockConfig({
        [URGENT_OPTION_KEY]: "note.due" as BasesPropertyId,
        [IMPORTANT_OPTION_KEY]: "note.priority" as BasesPropertyId,
      }),
      DEFAULT_SETTINGS,
    );
    expect(axesShareWritableKey(ids)).toBe(false);
  });

  it("axesShareWritableKey — 非 note.*（formula.*）は同一文字列でも false（書込不可軸は別ガードが弾く）", () => {
    // given: 両軸が同じ formula.x。toFrontmatterKey が null になるため同一キー扱いにしない
    const ids = resolveAxisPropertyIds(
      mockConfig({
        [URGENT_OPTION_KEY]: "formula.x" as BasesPropertyId,
        [IMPORTANT_OPTION_KEY]: "formula.x" as BasesPropertyId,
      }),
      DEFAULT_SETTINGS,
    );
    // when / then: null === null で誤検出しない（書込不可は resolveWritableAxisKeys/読み取りの別経路で未分類化）
    expect(axesShareWritableKey(ids)).toBe(false);
  });
});
