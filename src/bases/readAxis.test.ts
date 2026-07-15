import { describe, expect, it } from "vitest";
import type { BasesEntry, BasesPropertyId, BasesViewConfig, Value } from "obsidian";
import { BooleanValue, NullValue, NumberValue, StringValue } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import {
  COMPLETION_OPTION_KEY,
  IMPORTANT_OPTION_KEY,
  URGENT_OPTION_KEY,
  axesShareWritableKey,
  hasUnsupportedAxisValue,
  isUnsupportedAxisValue,
  readAxisReadings,
  readAxisValues,
  readCompletionState,
  resolveAxisPropertyIds,
  resolveCompletionId,
  resolveCompletionKey,
  resolveWritableAxisKeys,
  toFrontmatterKey,
  type AxisPropertyIds,
} from "./readAxis";
// ErrorValue は obsidian 1.13.x が型定義を export しない（getValue の JSDoc が @link ErrorValue と
// 言及するのみ）ため "obsidian" からは import できない。stub が提供する「アダプタが特定認識しない
// 未対応 Value 型の代表」を直接 import して default-lock を検証する（#121・AC2/AC4）。
import { ErrorValue } from "../test-support/obsidianStub";

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

describe("axesShareWritableKey — 完了キー衝突との独立（軸×完了は resolveCompletionId が別途 pairwise 判定）", () => {
  it("axesShareWritableKey — 非 note.*（formula/file）軸は書込不可のため衝突と見なさない", () => {
    // given: 両軸とも formula.*（書き戻せない）。同一表現でも衝突対象外（toFrontmatterKey が null）
    const ids: AxisPropertyIds = {
      urgent: "formula.score" as BasesPropertyId,
      important: "formula.score" as BasesPropertyId,
    };
    expect(axesShareWritableKey(ids)).toBe(false);
  });
});

describe("resolveCompletionId / resolveCompletionKey（#105 F10 完了プロパティ解決・既定 done/opt-out・3 キーガード）", () => {
  it("resolveCompletionId — 既定（settings=done・config 未設定）は note.done で解決（初期状態で有効）", () => {
    // given / when / then: completionProperty 既定は "done" のため完了トグルは有効
    expect(resolveCompletionId(null, DEFAULT_SETTINGS)).toBe("note.done");
    expect(resolveCompletionKey(null, DEFAULT_SETTINGS)).toBe("done");
  });

  it("resolveCompletionId — 明示的な空文字は null＝機能オフ（opt-out）", () => {
    // given: 利用者が完了プロパティを明示的に空へ（既定 done を無効化）
    const settings = { ...DEFAULT_SETTINGS, completionProperty: "" };
    // when / then: 空は機能無効（チェックボタンを出さない）
    expect(resolveCompletionId(null, settings)).toBeNull();
    expect(resolveCompletionKey(null, settings)).toBeNull();
  });

  it("resolveCompletionId — settings デフォルト（completionProperty=done）を note.done で解決", () => {
    // given
    const settings = { ...DEFAULT_SETTINGS, completionProperty: "done" };
    // when / then
    expect(resolveCompletionId(null, settings)).toBe("note.done");
    expect(resolveCompletionKey(null, settings)).toBe("done");
  });

  it("resolveCompletionId — ビュー options（config）を主に使う（settings より優先）", () => {
    // given: config が note.finished を指す
    const config = mockConfig({ [COMPLETION_OPTION_KEY]: "note.finished" as BasesPropertyId });
    const settings = { ...DEFAULT_SETTINGS, completionProperty: "done" };
    // when / then
    expect(resolveCompletionId(config, settings)).toBe("note.finished");
    expect(resolveCompletionKey(config, settings)).toBe("finished");
  });

  it("resolveCompletionKey — 非 note.*（formula.*/file.*）は null＝書き戻せないので弾く", () => {
    const formulaConfig = mockConfig({ [COMPLETION_OPTION_KEY]: "formula.done" as BasesPropertyId });
    const fileConfig = mockConfig({ [COMPLETION_OPTION_KEY]: "file.name" as BasesPropertyId });
    expect(resolveCompletionKey(formulaConfig, DEFAULT_SETTINGS)).toBeNull();
    expect(resolveCompletionKey(fileConfig, DEFAULT_SETTINGS)).toBeNull();
  });

  it("resolveCompletionKey — 完了キーが緊急軸と同一なら null（3 キー衝突ガード・AC3）", () => {
    // given: 完了プロパティが緊急軸（既定 note.urgent）と同一キー
    const settings = { ...DEFAULT_SETTINGS, completionProperty: "urgent" };
    // when / then: 完了書き込みが軸値を巻き添えに壊すため機能無効（チェックボタンを出さない）
    expect(resolveCompletionKey(null, settings)).toBeNull();
    expect(resolveCompletionId(null, settings)).toBeNull();
  });

  it("resolveCompletionKey — 完了キーが重要軸と同一でも null（両軸どちらとの衝突も弾く）", () => {
    const settings = { ...DEFAULT_SETTINGS, completionProperty: "important" };
    expect(resolveCompletionKey(null, settings)).toBeNull();
  });

  it("resolveCompletionKey — 軸と別キーなら通す（正常設定）", () => {
    const settings = { ...DEFAULT_SETTINGS, completionProperty: "done" };
    expect(resolveCompletionKey(null, settings)).toBe("done");
  });

  it("resolveCompletionId — 渡した axes で 3 キー衝突を判定する（解決済み軸の再利用・レビュー指摘 #10）", () => {
    // given: config は完了=note.done を指す。呼び出し側が解決済み軸として urgent=note.done を渡す
    const config = mockConfig({ [COMPLETION_OPTION_KEY]: "note.done" as BasesPropertyId });
    const axes: AxisPropertyIds = {
      urgent: "note.done" as BasesPropertyId,
      important: "note.important" as BasesPropertyId,
    };
    // when / then: 渡した軸 urgent=note.done と完了 note.done が衝突＝null（機能無効）
    expect(resolveCompletionId(config, DEFAULT_SETTINGS, axes)).toBeNull();
  });

  it("resolveCompletionId — axes 省略時は内部解決（従来挙動と同値）", () => {
    // given: 完了=note.done・軸は既定（note.urgent/note.important）で衝突しない
    const config = mockConfig({ [COMPLETION_OPTION_KEY]: "note.done" as BasesPropertyId });
    // when / then: 渡さなくても内部で resolveAxisPropertyIds し、衝突なし＝note.done
    expect(resolveCompletionId(config, DEFAULT_SETTINGS)).toBe("note.done");
  });

  it("resolveCompletionId — axes を渡すと軸キーを再解決しない（1 レンダーの二重解決回避・#10）", () => {
    // given: getAsPropertyId が引かれたキーを記録する config
    const keys: string[] = [];
    const config: Pick<BasesViewConfig, "getAsPropertyId"> = {
      getAsPropertyId: (key: string) => {
        keys.push(key);
        return (key === COMPLETION_OPTION_KEY ? "note.done" : null) as BasesPropertyId;
      },
    };
    // 事前に軸を解決（toViewModel 相当）→ その分の記録はクリアする
    const axes = resolveAxisPropertyIds(config, DEFAULT_SETTINGS);
    keys.length = 0;
    // when: 解決済み axes を渡して完了を解決
    resolveCompletionId(config, DEFAULT_SETTINGS, axes);
    // then: 完了キーのみ引き、URGENT/IMPORTANT は再解決しない（軸の getAsPropertyId を二度引かない）
    expect(keys).toEqual([COMPLETION_OPTION_KEY]);
    expect(keys).not.toContain(URGENT_OPTION_KEY);
    expect(keys).not.toContain(IMPORTANT_OPTION_KEY);
  });
});

describe("readCompletionState（#105 F10 完了状態の読み取り・非 boolean ガード）", () => {
  const DONE_ID = "note.done" as BasesPropertyId;

  it("readCompletionState — done:true は completed=true・unsupported=false（完了）", () => {
    const entry = mockEntry({ [DONE_ID]: TRUE });
    expect(readCompletionState(entry, DONE_ID)).toEqual({ completed: true, unsupported: false });
  });

  it("readCompletionState — done:false は completed=false・unsupported=false（未完了・トグル可）", () => {
    const entry = mockEntry({ [DONE_ID]: FALSE });
    expect(readCompletionState(entry, DONE_ID)).toEqual({ completed: false, unsupported: false });
  });

  it("readCompletionState — done 未定義（absent）は completed=false・unsupported=false（新規に書ける）", () => {
    const entry = mockEntry({ [DONE_ID]: ABSENT });
    expect(readCompletionState(entry, DONE_ID)).toEqual({ completed: false, unsupported: false });
  });

  it("readCompletionState — 非 boolean（日付=文字列/数値）は unsupported=true（true 上書きで破壊するため無効化・AC2）", () => {
    // given: 完了を日付型で持つ運用（completed: 2026-07-06 相当）
    const dateEntry = mockEntry({ [DONE_ID]: new StringValue("2026-07-06") });
    const numEntry = mockEntry({ [DONE_ID]: new NumberValue(1) });
    // when / then: 元値を破壊しないようトグルを無効化する
    expect(readCompletionState(dateEntry, DONE_ID)).toEqual({ completed: false, unsupported: true });
    expect(readCompletionState(numEntry, DONE_ID)).toEqual({ completed: false, unsupported: true });
  });

  it("readCompletionState — getValue が throw したら安全側で unsupported=true（型を確証できない・#2 と同型）", () => {
    // given: 完了軸の getValue が例外（Bases churn）
    const entry = {
      file: { path: "a.md", basename: "a" },
      getValue: () => {
        throw new Error("boom");
      },
    } as unknown as BasesEntry;
    // when / then: throw を absent と同一視せず、書き込み経路を塞ぐ（非 boolean 破壊の再開を防ぐ）
    expect(readCompletionState(entry, DONE_ID)).toEqual({ completed: false, unsupported: true });
  });
});

describe("readAxisReadings — 数値しきい値軸の kind-aware 読み取り（#121 v0.3-1a）", () => {
  const ids: AxisPropertyIds = {
    urgent: "note.urgent" as BasesPropertyId,
    important: "note.important" as BasesPropertyId,
  };
  // urgent 軸だけ threshold=5 を設定（important は未設定=null＝数値軸オフ）。
  const thresholds = { urgent: 5, important: null };

  it("AC1 — 有限数 >= threshold は true 側へ配置（境界ちょうども true 側）", () => {
    // given: 緊急軸に数値 5（threshold=5・境界ちょうど）
    const entry = mockEntry({ "note.urgent": new NumberValue(5), "note.important": TRUE });
    // when
    const readings = readAxisReadings(entry, ids, thresholds);
    // then: 5>=5 で true 側
    expect(readings.urgent.side).toBe(true);
  });

  it("AC1 — 有限数 < threshold は false 側へ配置", () => {
    const entry = mockEntry({ "note.urgent": new NumberValue(3), "note.important": TRUE });
    const readings = readAxisReadings(entry, ids, thresholds);
    expect(readings.urgent.side).toBe(false); // 3<5
  });

  it("AC1+AC5 — 有限数の数値軸カードは配置されるが locked（書き戻し未実装・1a）", () => {
    // given: 緊急軸に数値 9（threshold=5）
    const entry = mockEntry({ "note.urgent": new NumberValue(9), "note.important": TRUE });
    // when
    const readings = readAxisReadings(entry, ids, thresholds);
    // then: 正しい象限側に置かれる（配置）と同時に locked（掴めない＝1a はデータ破壊経路を作らない）
    expect(readings.urgent.side).toBe(true);
    expect(readings.urgent.locked).toBe(true);
  });

  it("AC2 — 非有限数（NaN/±Inf）は未分類＋locked", () => {
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const entry = mockEntry({
        "note.urgent": new NumberValue(nonFinite),
        "note.important": TRUE,
      });
      const reading = readAxisReadings(entry, ids, thresholds).urgent;
      expect(reading.side).toBeUndefined();
      expect(reading.locked).toBe(true);
    }
  });

  it("AC2 — 型不一致（数値軸に文字列）は未分類＋locked（既存値を保護）", () => {
    const entry = mockEntry({ "note.urgent": new StringValue("high"), "note.important": TRUE });
    const reading = readAxisReadings(entry, ids, thresholds).urgent;
    expect(reading.side).toBeUndefined();
    expect(reading.locked).toBe(true);
  });

  it("AC2 — ErrorValue（未対応 Value 型の代表）は安全側で未分類＋locked", () => {
    // given: 数値軸に ErrorValue（formula エラー等）。obsidian は実 ErrorValue を export しないため
    // アダプタは既知型に一致しない Value を一律ロックに倒す（default-lock）。stub の ErrorValue は
    // obsidian の Value 構造（equals/looseEquals/renderTo）を持たないため、未対応 Value 型として Value へキャストする。
    const entry = mockEntry({
      "note.urgent": new ErrorValue("formula error") as unknown as Value,
      "note.important": TRUE,
    });
    const reading = readAxisReadings(entry, ids, thresholds).urgent;
    expect(reading.side).toBeUndefined();
    expect(reading.locked).toBe(true);
  });

  it("AC2 — getValue が throw したら安全側で未分類＋locked（churn 耐性）", () => {
    const entry = {
      file: { path: "a.md", basename: "a" },
      getValue: (id: BasesPropertyId) => {
        if (id === "note.urgent") throw new Error("boom");
        return TRUE;
      },
    } as unknown as BasesEntry;
    const reading = readAxisReadings(entry, ids, thresholds).urgent;
    expect(reading.side).toBeUndefined();
    expect(reading.locked).toBe(true);
  });

  it("ゲート — threshold 未設定（null）の軸では数値も v1 のまま未分類＋locked（不意の配置を防ぐ）", () => {
    // given: important 軸は threshold=null。数値でも配置せず v1（未分類＋locked）を維持する。
    const entry = mockEntry({ "note.urgent": TRUE, "note.important": new NumberValue(3) });
    const reading = readAxisReadings(entry, ids, thresholds).important;
    expect(reading.side).toBeUndefined();
    expect(reading.locked).toBe(true);
  });

  it("AC3 — boolean 軸は挙動不変（threshold 有無に依らず配置・非ロック）", () => {
    // given: 緊急軸に数値（threshold あり）、重要軸は boolean false
    const entry = mockEntry({ "note.urgent": new NumberValue(9), "note.important": FALSE });
    const readings = readAxisReadings(entry, ids, thresholds);
    // then: boolean 軸は boolean として扱う（配置・非ロック）
    expect(readings.important.side).toBe(false);
    expect(readings.important.locked).toBe(false);
  });

  it("AC3 — absent は未分類・非ロック（欠損は分類として新規に書ける・不変）", () => {
    const entry = mockEntry({ "note.urgent": ABSENT, "note.important": FALSE });
    const reading = readAxisReadings(entry, ids, thresholds).urgent;
    expect(reading.side).toBeUndefined();
    expect(reading.locked).toBe(false);
  });

  it("非 note.*（formula/file）軸は数値でも未分類・非ロック（書込経路が無い・読み書き対称の不変）", () => {
    // given: 緊急軸を書き戻し不可な formula.* に（threshold を付けても）
    const mixedIds: AxisPropertyIds = {
      urgent: "formula.score" as BasesPropertyId,
      important: "note.important" as BasesPropertyId,
    };
    const entry = mockEntry({ "formula.score": new NumberValue(9), "note.important": TRUE });
    const reading = readAxisReadings(entry, mixedIds, { urgent: 5, important: null }).urgent;
    // then: formula は書込不可のためロック対象外（既存の非対称と対称・Notice 経路に委ねる）
    expect(reading.side).toBeUndefined();
    expect(reading.locked).toBe(false);
  });
});

describe("readAxisValues / hasUnsupportedAxisValue — threshold 引数で数値軸を認識（#121）", () => {
  const ids: AxisPropertyIds = {
    urgent: "note.urgent" as BasesPropertyId,
    important: "note.important" as BasesPropertyId,
  };

  it("readAxisValues — threshold 設定時、有限数を配置 side（value>=threshold）へ正規化する", () => {
    const entry = mockEntry({
      "note.urgent": new NumberValue(9),
      "note.important": new NumberValue(1),
    });
    // 9>=5 → true / 1<5 → false
    expect(readAxisValues(entry, ids, { urgent: 5, important: 5 })).toEqual({
      urgent: true,
      important: false,
    });
  });

  it("readAxisValues — threshold 未指定（従来呼び出し）は数値を未分類化する（v1・AC3 回帰）", () => {
    const entry = mockEntry({ "note.urgent": new NumberValue(9), "note.important": TRUE });
    expect(readAxisValues(entry, ids)).toEqual({ urgent: undefined, important: true });
  });

  it("hasUnsupportedAxisValue — threshold 設定時も数値軸カードは locked（1a・書き戻し未実装）", () => {
    const entry = mockEntry({ "note.urgent": new NumberValue(9), "note.important": TRUE });
    expect(hasUnsupportedAxisValue(entry, ids, { urgent: 5, important: null })).toBe(true);
  });

  it("hasUnsupportedAxisValue — threshold 設定でも boolean/absent のみのカードは非ロック（回帰）", () => {
    const entry = mockEntry({ "note.urgent": TRUE, "note.important": ABSENT });
    expect(hasUnsupportedAxisValue(entry, ids, { urgent: 5, important: 5 })).toBe(false);
  });
});

describe("obsidianStub — NumberValue/ErrorValue の整合（#121 AC4）", () => {
  it("NumberValue は toString で数値文字列を返し Number() で読み戻せる・instanceof 成立", () => {
    const value = new NumberValue(3.5);
    expect(value instanceof NumberValue).toBe(true);
    expect(Number(value.toString())).toBe(3.5);
  });

  it("NumberValue の非有限（NaN/Inf）も toString→Number で round-trip する（Number.isFinite で弾ける形）", () => {
    expect(Number.isFinite(Number(new NumberValue(Number.NaN).toString()))).toBe(false);
    expect(Number.isFinite(Number(new NumberValue(Number.POSITIVE_INFINITY).toString()))).toBe(
      false,
    );
  });

  it("ErrorValue は instanceof が成立し他の Value 型と区別される（未対応型の代表）", () => {
    const errorValue = new ErrorValue("boom");
    expect(errorValue instanceof ErrorValue).toBe(true);
    expect(errorValue instanceof NumberValue).toBe(false);
    expect(errorValue instanceof BooleanValue).toBe(false);
  });
});
