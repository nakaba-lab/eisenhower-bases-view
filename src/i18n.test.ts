import { describe, expect, it } from "vitest";
import { QUADRANT_KEYS } from "./logic/quadrant";
import { messagesFor, resolveLanguage, type Language } from "./i18n";

/**
 * i18n — 表示言語の解決（Auto 追従＋手動上書き）と、言語別メッセージ束（#23 F6・AC4）。
 *
 * `resolveLanguage(setting, appLang)`: `en`/`ja` は明示、`auto` は Obsidian のアプリ言語
 * （`ja*` → ja、それ以外/未知/未設定 → en）に追従する（純関数＝Obsidian ランタイム非依存で
 * appLang は呼び出し側〔アダプタ〕が渡す）。`messagesFor(lang)`: 静的 UI 文言・既定象限ラベル・
 * 軸ラベル・SR 文言・アナウンステンプレートを言語別に返す（既定象限ラベルは言語で切り替わる＝AC4）。
 */

describe("resolveLanguage — Auto 追従＋手動上書き（AC4）", () => {
  it("resolveLanguage — 明示 en/ja は appLang に関わらずそれを返す", () => {
    expect(resolveLanguage("en", null)).toBe("en");
    expect(resolveLanguage("en", "ja")).toBe("en");
    expect(resolveLanguage("ja", "en")).toBe("ja");
  });

  it("resolveLanguage — auto は Obsidian のアプリ言語が ja 系なら ja", () => {
    expect(resolveLanguage("auto", "ja")).toBe("ja");
    expect(resolveLanguage("auto", "ja-JP")).toBe("ja");
  });

  it("resolveLanguage — auto で en/未知/未設定は en（フォールバック）", () => {
    expect(resolveLanguage("auto", "en")).toBe("en");
    expect(resolveLanguage("auto", "en-US")).toBe("en");
    expect(resolveLanguage("auto", "fr")).toBe("en");
    expect(resolveLanguage("auto", null)).toBe("en");
    expect(resolveLanguage("auto", undefined)).toBe("en");
    expect(resolveLanguage("auto", "")).toBe("en");
  });
});

describe("messagesFor — 言語別メッセージ束（AC4）", () => {
  it("messagesFor — 静的 UI 文言が言語で切り替わる", () => {
    // given / when / then
    expect(messagesFor("ja").loading).toBe("読み込み中…");
    expect(messagesFor("en").loading).toBe("Loading…");
    expect(messagesFor("ja").empty).toBe("表示するノートがありません");
    expect(messagesFor("en").empty).toBe("No notes to display");
    expect(messagesFor("ja").emptyQuadrant).toBe("なし");
    expect(messagesFor("en").emptyQuadrant).toBe("None");
    expect(messagesFor("ja").unclassifiedLabel).toBe("未分類");
    expect(messagesFor("en").unclassifiedLabel).toBe("Unclassified");
  });

  it("messagesFor — 既定象限ラベルが言語で切り替わる（AC4 の要）", () => {
    // given / when / then: en と ja で既定ラベルが異なる（切り替わる）
    expect(messagesFor("en").quadrantLabels.do).toBe("Do");
    expect(messagesFor("ja").quadrantLabels.do).toBe("実行");
    for (const key of QUADRANT_KEYS) {
      expect(messagesFor("en").quadrantLabels[key]).not.toBe(
        messagesFor("ja").quadrantLabels[key],
      );
    }
  });

  it("messagesFor — 全象限に既定ラベルと軸ラベルが定義されている", () => {
    for (const lang of ["en", "ja"] as Language[]) {
      for (const key of QUADRANT_KEYS) {
        expect(messagesFor(lang).quadrantLabels[key].length).toBeGreaterThan(0);
        expect(messagesFor(lang).axisLabels[key].length).toBeGreaterThan(0);
      }
    }
  });

  it("messagesFor — 軸ラベルが言語で切り替わる", () => {
    expect(messagesFor("ja").axisLabels.do).toBe("重要 × 緊急");
    expect(messagesFor("en").axisLabels.do).toBe("Important × Urgent");
  });

  it("messagesFor — アナウンステンプレートがタイトル/ラベルを差し込む", () => {
    // given / when
    const droppedJa = messagesFor("ja").dropped("タスクA", "実行");
    const droppedEn = messagesFor("en").dropped("TaskA", "Do");
    // then: タイトルとラベルの双方を含む
    expect(droppedJa).toContain("タスクA");
    expect(droppedJa).toContain("実行");
    expect(droppedEn).toContain("TaskA");
    expect(droppedEn).toContain("Do");
    expect(messagesFor("ja").moveFailed("タスクA")).toContain("タスクA");
  });
});

describe("messagesFor — undo（直前1手の元に戻す）文言（draft）", () => {
  it("messagesFor — undo の静的文言（トーストボタン/コマンド名/該当なし）が言語で切り替わる", () => {
    for (const lang of ["en", "ja"] as Language[]) {
      const messages = messagesFor(lang);
      expect(messages.undoRegionLabel.length).toBeGreaterThan(0); // トースト領域の aria-label
      expect(messages.undoMove.length).toBeGreaterThan(0); // トーストのボタンラベル
      expect(messages.undoCommandName.length).toBeGreaterThan(0); // コマンドパレット名
      expect(messages.noUndo.length).toBeGreaterThan(0); // 記録なし時の Notice
    }
    // ja と en で異なる（実際に翻訳されている）
    expect(messagesFor("ja").undoMove).not.toBe(messagesFor("en").undoMove);
  });

  it("messagesFor — undone/undoFailed テンプレートがノート名を差し込む", () => {
    expect(messagesFor("ja").undone("タスクA")).toContain("タスクA");
    expect(messagesFor("en").undone("TaskA")).toContain("TaskA");
    expect(messagesFor("ja").undoFailed("タスクA")).toContain("タスクA");
    expect(messagesFor("en").undoFailed("TaskA")).toContain("TaskA");
  });
});

describe("messagesFor — 設定タブ・Bases options の i18n（#23 F6 スコープ拡張）", () => {
  it("messagesFor — 設定タブの全文言が言語別に定義され en/ja で異なる", () => {
    const jaSettings = messagesFor("ja").settings;
    const enSettings = messagesFor("en").settings;
    const keys = Object.keys(jaSettings) as (keyof typeof jaSettings)[];
    // 全キーが両言語で非空、かつ翻訳されている（同一文字列で取り残されていない）
    for (const key of keys) {
      expect(jaSettings[key].length).toBeGreaterThan(0);
      expect(enSettings[key].length).toBeGreaterThan(0);
      expect(jaSettings[key]).not.toBe(enSettings[key]);
    }
    // 代表値のスポットチェック
    expect(jaSettings.languageDesc).toContain("Obsidian");
    expect(enSettings.languageName).toBe("Display language");
  });

  it("messagesFor — Bases 軸セレクタの displayName が言語で切り替わる", () => {
    expect(messagesFor("ja").axisOption.urgency).toBe("緊急度軸プロパティ");
    expect(messagesFor("en").axisOption.urgency).toBe("Urgency axis property");
    expect(messagesFor("ja").axisOption.important).not.toBe(
      messagesFor("en").axisOption.important,
    );
  });
});

describe("messagesFor — アダプタ Notice・件数・括弧ジョイナの i18n", () => {
  it("messagesFor — アダプタ層 Notice 本文が言語別に定義され en/ja で異なる", () => {
    const noticeKeys = [
      "fileNotFoundForMove",
      "fileNotFoundForOpen",
      "axisNotWritable",
      "writeBackFailed",
      "openFailed",
      "basesUnavailable",
    ] as const;
    for (const key of noticeKeys) {
      expect(messagesFor("ja")[key].length).toBeGreaterThan(0);
      expect(messagesFor("en")[key].length).toBeGreaterThan(0);
      expect(messagesFor("ja")[key]).not.toBe(messagesFor("en")[key]);
    }
  });

  it("messagesFor — itemCount が件数を差し込み言語別（英は単複分岐・日 件）", () => {
    expect(messagesFor("en").itemCount(5)).toBe("5 items");
    // 英語は単複を分岐する（count=1 で "1 items" にしない・nit の是正）
    expect(messagesFor("en").itemCount(1)).toBe("1 item");
    expect(messagesFor("en").itemCount(0)).toBe("0 items");
    expect(messagesFor("ja").itemCount(5)).toBe("5 件");
    expect(messagesFor("ja").itemCount(1)).toBe("1 件");
  });

  it("messagesFor — unclassifiedHidden が件数を差し込み言語別（無言空表示を避けるヒント）", () => {
    expect(messagesFor("ja").unclassifiedHidden(3)).toContain("3 件");
    expect(messagesFor("en").unclassifiedHidden(2)).toContain("2 notes are");
    expect(messagesFor("en").unclassifiedHidden(1)).toContain("1 note is"); // 単複分岐
    expect(messagesFor("ja").unclassifiedHidden(1)).not.toBe(
      messagesFor("en").unclassifiedHidden(1),
    );
  });

  it("messagesFor — labelWithAxis は英で半角括弧・日で全角括弧を使う（全角括弧の英混入を断つ）", () => {
    // then: 英語文脈に全角括弧を混ぜない（nit の是正）
    expect(messagesFor("en").labelWithAxis("Do", "Important × Urgent")).toBe(
      "Do (Important × Urgent)",
    );
    expect(messagesFor("ja").labelWithAxis("実行", "重要 × 緊急")).toBe(
      "実行（重要 × 緊急）",
    );
  });

  it("messagesFor — cardLockedLabel はノート名を差し込み言語別", () => {
    expect(messagesFor("en").cardLockedLabel("TaskA")).toContain("TaskA");
    expect(messagesFor("ja").cardLockedLabel("タスクA")).toContain("タスクA");
    expect(messagesFor("ja").cardLockedLabel("x")).not.toBe(
      messagesFor("en").cardLockedLabel("x"),
    );
  });
});
