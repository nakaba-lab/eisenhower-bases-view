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

describe("mergeSettings — カード追加プロパティ表示の設定（#104 F7）", () => {
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
