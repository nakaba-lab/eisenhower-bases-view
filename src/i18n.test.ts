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
