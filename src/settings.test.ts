import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, type EisenhowerSettings } from "./settings";

/**
 * settings — プラグイン設定の既定値と、`loadData()` の生データを既定へマージする純関数。
 *
 * #23（F6）で `language`／`quadrantLabels`／`quadrantColors` を追加した。永続化（`saveData`）で
 * 保存された部分データを再読込するとき（AC5）、欠損フィールド・ネストの欠損キー（象限別ラベル/色の
 * 一部だけ保存）を既定で補完しないと `undefined` 参照で壊れる。`mergeSettings` はそのマージを純関数で
 * 担い、単体テストで固定する（`Object.assign` の浅いマージではネストが欠ける）。
 */

describe("mergeSettings — 既定補完（AC5 読み書き）", () => {
  it("mergeSettings — undefined を渡すと DEFAULT_SETTINGS と等価", () => {
    // given / when / then: 初回起動（data.json なし）で loadData() が null
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("mergeSettings — 空オブジェクトは全フィールドを既定で埋める", () => {
    // given / when
    const merged = mergeSettings({});
    // then
    expect(merged).toEqual(DEFAULT_SETTINGS);
    expect(merged.language).toBe("auto");
    expect(merged.quadrantLabels).toEqual({ do: "", schedule: "", delegate: "", delete: "" });
    expect(merged.quadrantColors).toEqual({ do: "", schedule: "", delegate: "", delete: "" });
  });

  it("mergeSettings — 既存フィールド（軸デフォルト・showUnclassified）を保持する", () => {
    // given: F1〜F5 時代の data.json（F6 フィールドを持たない）
    const legacy = {
      defaultUrgencyProperty: "due",
      defaultImportanceProperty: "priority",
      showUnclassified: false,
    };
    // when
    const merged = mergeSettings(legacy);
    // then: 既存値は保持しつつ F6 フィールドは既定補完
    expect(merged.defaultUrgencyProperty).toBe("due");
    expect(merged.defaultImportanceProperty).toBe("priority");
    expect(merged.showUnclassified).toBe(false);
    expect(merged.language).toBe("auto");
  });

  it("mergeSettings — language を保存値から復元（再起動後も保持・AC5）", () => {
    expect(mergeSettings({ language: "ja" }).language).toBe("ja");
    expect(mergeSettings({ language: "en" }).language).toBe("en");
  });

  it("mergeSettings — 不正な language は既定（auto）へフォールバック", () => {
    // given / when / then: 手編集された data.json などの不正値を弾く
    expect(mergeSettings({ language: "fr" }).language).toBe("auto");
    expect(mergeSettings({ language: 42 }).language).toBe("auto");
  });

  it("mergeSettings — 象限ラベルは一部キーだけ保存されても欠損キーを既定（空文字）で補完", () => {
    // given: do だけカスタムした状態を保存
    const partial = { quadrantLabels: { do: "実行!" } };
    // when
    const merged = mergeSettings(partial);
    // then: 欠損キーは "" に補完され undefined 参照で壊れない
    expect(merged.quadrantLabels).toEqual({
      do: "実行!",
      schedule: "",
      delegate: "",
      delete: "",
    });
  });

  it("mergeSettings — 象限色も一部キー保存で欠損キーを既定補完", () => {
    const merged = mergeSettings({ quadrantColors: { schedule: "#4a9d8e" } });
    expect(merged.quadrantColors).toEqual({
      do: "",
      schedule: "#4a9d8e",
      delegate: "",
      delete: "",
    });
  });

  it("mergeSettings — 返り値は DEFAULT_SETTINGS を破壊しない（新規オブジェクト）", () => {
    // given / when
    const merged: EisenhowerSettings = mergeSettings({ quadrantLabels: { do: "X" } });
    merged.quadrantLabels.schedule = "mutated";
    // then: 既定の共有参照を書き換えていない
    expect(DEFAULT_SETTINGS.quadrantLabels.schedule).toBe("");
  });
});

describe("mergeSettings — 滞留しきい値 stagnationThresholdDays（#106 F9）", () => {
  it("mergeSettings — 既定は 14 日（未保存・レガシー data.json でも補完）", () => {
    // given / when / then: 初回・F6 時代の data.json（滞留フィールドを持たない）でも既定 14
    expect(DEFAULT_SETTINGS.stagnationThresholdDays).toBe(14);
    expect(mergeSettings({}).stagnationThresholdDays).toBe(14);
    expect(
      mergeSettings({ defaultUrgencyProperty: "due" }).stagnationThresholdDays,
    ).toBe(14);
  });

  it("mergeSettings — 保存された有効な日数を復元する（0=オフ含む）", () => {
    expect(mergeSettings({ stagnationThresholdDays: 30 }).stagnationThresholdDays).toBe(30);
    expect(mergeSettings({ stagnationThresholdDays: 0 }).stagnationThresholdDays).toBe(0);
  });

  it("mergeSettings — 不正な日数（負・非数値・NaN）は既定 14 へフォールバック", () => {
    // given / when / then: 手編集された data.json 等の不正値を弾く
    expect(mergeSettings({ stagnationThresholdDays: -3 }).stagnationThresholdDays).toBe(14);
    expect(mergeSettings({ stagnationThresholdDays: "21" }).stagnationThresholdDays).toBe(14);
    expect(mergeSettings({ stagnationThresholdDays: Number.NaN }).stagnationThresholdDays).toBe(14);
  });

  it("mergeSettings — 小数の日数は floor して整数日にする", () => {
    expect(mergeSettings({ stagnationThresholdDays: 20.7 }).stagnationThresholdDays).toBe(20);
  });
});

describe("mergeSettings — カード追加プロパティ表示の設定（#104 F8）", () => {
  it("DEFAULT_SETTINGS — 既定は表示 0 個・日付強調オフ（カード密度は現状維持・AC3）", () => {
    expect(DEFAULT_SETTINGS.cardBadgeProperties).toEqual([]);
    expect(DEFAULT_SETTINGS.emphasizePastDates).toBe(false);
  });

  it("mergeSettings — 空オブジェクトはバッジ設定も既定で埋める", () => {
    const merged = mergeSettings({});
    expect(merged.cardBadgeProperties).toEqual([]);
    expect(merged.emphasizePastDates).toBe(false);
  });

  it("mergeSettings — cardBadgeProperties を保存値から復元（文字列配列）", () => {
    const merged = mergeSettings({ cardBadgeProperties: ["note.due", "file.mtime"] });
    expect(merged.cardBadgeProperties).toEqual(["note.due", "file.mtime"]);
  });

  it("mergeSettings — cardBadgeProperties の非文字列要素/非配列は弾いて既定へ倒す（手編集の防御）", () => {
    // given / when / then: 配列でない・要素が非文字列は既定（空配列 or 文字列のみ）へ
    expect(mergeSettings({ cardBadgeProperties: "note.due" }).cardBadgeProperties).toEqual([]);
    expect(
      mergeSettings({ cardBadgeProperties: ["note.due", 42, null, "note.tags"] })
        .cardBadgeProperties,
    ).toEqual(["note.due", "note.tags"]);
  });

  it("mergeSettings — emphasizePastDates を保存値から復元・不正値は既定 false", () => {
    expect(mergeSettings({ emphasizePastDates: true }).emphasizePastDates).toBe(true);
    expect(mergeSettings({ emphasizePastDates: "yes" }).emphasizePastDates).toBe(false);
  });

  it("mergeSettings — 返り値の cardBadgeProperties は新規配列（DEFAULT_SETTINGS を破壊しない）", () => {
    const merged = mergeSettings({});
    merged.cardBadgeProperties.push("note.x");
    expect(DEFAULT_SETTINGS.cardBadgeProperties).toEqual([]);
  });
});

describe("mergeSettings — カード上の完了トグルの設定（#105 F10）", () => {
  it("DEFAULT_SETTINGS — 既定は完了プロパティ空（機能オフ＝opt-in）・淡色表示オフ", () => {
    expect(DEFAULT_SETTINGS.completionProperty).toBe("");
    expect(DEFAULT_SETTINGS.dimCompleted).toBe(false);
  });

  it("mergeSettings — 空オブジェクト・レガシー data.json でも完了設定を既定で埋める", () => {
    const merged = mergeSettings({});
    expect(merged.completionProperty).toBe("");
    expect(merged.dimCompleted).toBe(false);
    // F9 時代の data.json（完了フィールドを持たない）でも補完される
    expect(mergeSettings({ stagnationThresholdDays: 30 }).completionProperty).toBe("");
  });

  it("mergeSettings — completionProperty を保存値から復元（プロパティ名文字列）", () => {
    expect(mergeSettings({ completionProperty: "done" }).completionProperty).toBe("done");
  });

  it("mergeSettings — completionProperty の非文字列は既定（空文字＝オフ）へフォールバック", () => {
    expect(mergeSettings({ completionProperty: 42 }).completionProperty).toBe("");
    expect(mergeSettings({ completionProperty: null }).completionProperty).toBe("");
  });

  it("mergeSettings — dimCompleted を保存値から復元・不正値は既定 false", () => {
    expect(mergeSettings({ dimCompleted: true }).dimCompleted).toBe(true);
    expect(mergeSettings({ dimCompleted: "yes" }).dimCompleted).toBe(false);
  });

  it("mergeSettings — stagnationThresholdDays は共有正規化（toThresholdDays）で 0 を保持し小数は floor（レビュー指摘 #9）", () => {
    // 0（オフ）は既定 14 に潰れない（`toThresholdDays(0) ?? DEFAULT === 0`）
    expect(mergeSettings({ stagnationThresholdDays: 0 }).stagnationThresholdDays).toBe(0);
    // 有効な非負整数は保持、小数は floor
    expect(mergeSettings({ stagnationThresholdDays: 30 }).stagnationThresholdDays).toBe(30);
    expect(mergeSettings({ stagnationThresholdDays: 20.7 }).stagnationThresholdDays).toBe(20);
  });

  it("mergeSettings — stagnationThresholdDays の不正値（負・NaN・非数値・欠損）は既定 14 へ（レビュー指摘 #9）", () => {
    expect(mergeSettings({ stagnationThresholdDays: -5 }).stagnationThresholdDays).toBe(14);
    expect(mergeSettings({ stagnationThresholdDays: Number.NaN }).stagnationThresholdDays).toBe(14);
    expect(mergeSettings({ stagnationThresholdDays: "30" }).stagnationThresholdDays).toBe(14);
    expect(mergeSettings({}).stagnationThresholdDays).toBe(14);
  });
});
