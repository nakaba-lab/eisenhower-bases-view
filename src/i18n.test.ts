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

  it("messagesFor — moveSucceededUndoable は成功文言に undo 到達方法（コマンド名）を添える（#1 発見可能性・#5 コマンド名一本化）", () => {
    // given: 呼び出し側は undoCommandName を渡してコマンド名の真実源を一本化する（リテラル重複を避ける・#5）
    const jaMsgs = messagesFor("ja");
    const enMsgs = messagesFor("en");
    // when: undo 導線がある成功のライブ通知（SR/キーボード利用者に undo の存在と到達手段を届ける）
    const ja = jaMsgs.moveSucceededUndoable("タスクA", "実行", jaMsgs.undoCommandName);
    const en = enMsgs.moveSucceededUndoable("TaskA", "Do", enMsgs.undoCommandName);
    // then: タイトル・ラベルに加え、undoCommandName（コマンド名）を実際に含む（乖離ガード＝#5）
    expect(ja).toContain("タスクA");
    expect(ja).toContain("実行");
    expect(ja).toContain(jaMsgs.undoCommandName);
    expect(ja).toContain("元に戻せます");
    expect(ja).not.toBe(jaMsgs.moveSucceeded("タスクA", "実行"));
    expect(en).toContain("TaskA");
    expect(en).toContain("Do");
    expect(en).toContain(enMsgs.undoCommandName);
    expect(en).not.toBe(enMsgs.moveSucceeded("TaskA", "Do"));
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

describe("messagesFor — カード追加プロパティ表示（バッジ）の i18n（#104 F8・AC6）", () => {
  it("messagesFor — badgeOption（セレクタ displayName）が番号を差し込み言語別", () => {
    // given / when: バッジセレクタの displayName は番号付き（badgeProperty1..3 に対応）
    const ja1 = messagesFor("ja").badgeOption(1);
    const en1 = messagesFor("en").badgeOption(1);
    // then: 番号を含み、言語別（en/ja で異なる）
    expect(ja1).toContain("1");
    expect(en1).toContain("1");
    expect(ja1).not.toBe(en1);
    expect(messagesFor("ja").badgeOption(2)).not.toBe(messagesFor("ja").badgeOption(1));
  });

  it("messagesFor — 設定タブのバッジ文言（名前・説明・強調トグル）が en/ja で欠けなく定義される", () => {
    // given: #104 で追加した設定タブ文言（読み取り専用注記を含む）
    const badgeKeys = [
      "cardBadgePropertiesName",
      "cardBadgePropertiesDesc",
      "emphasizePastDatesName",
      "emphasizePastDatesDesc",
    ] as const;
    for (const key of badgeKeys) {
      // then: 両言語で非空・翻訳されている（同一文字列で取り残されていない）
      expect(messagesFor("ja").settings[key].length).toBeGreaterThan(0);
      expect(messagesFor("en").settings[key].length).toBeGreaterThan(0);
      expect(messagesFor("ja").settings[key]).not.toBe(messagesFor("en").settings[key]);
    }
  });

  it("messagesFor — 設定タブのタグ軸文言（名前・説明）が en/ja で欠けなく定義される（#125 AC6）", () => {
    // given: #125 で追加したタグ軸の設定タブ文言
    const tagKeys = [
      "urgencyTagName",
      "urgencyTagDesc",
      "importanceTagName",
      "importanceTagDesc",
    ] as const;
    for (const key of tagKeys) {
      // then: 両言語で非空・翻訳されている（同一文字列で取り残されていない）
      expect(messagesFor("ja").settings[key].length).toBeGreaterThan(0);
      expect(messagesFor("en").settings[key].length).toBeGreaterThan(0);
      expect(messagesFor("ja").settings[key]).not.toBe(messagesFor("en").settings[key]);
    }
  });

  it("messagesFor — タグ軸説明は inline tag 非対応を明示する（#125 AC5）", () => {
    // then: 本文中の #tag（inline）は frontmatter に乗らず対象外であることを UI 文言で示す
    expect(messagesFor("en").settings.urgencyTagDesc.toLowerCase()).toContain("inline");
    expect(messagesFor("ja").settings.urgencyTagDesc).toContain("inline");
  });

  it("messagesFor — カード表示プロパティ説明は読み取り専用（formula/file も可）を明示する", () => {
    // then: 軸（書き戻し note.* 限定）と違い別サーフェスであることを UI 文言で示す
    expect(messagesFor("en").settings.cardBadgePropertiesDesc.toLowerCase()).toContain(
      "read-only",
    );
    expect(messagesFor("ja").settings.cardBadgePropertiesDesc).toContain("読み取り専用");
  });
});

describe("messagesFor — アダプタ Notice・件数・括弧ジョイナの i18n", () => {
  it("messagesFor — アダプタ層 Notice 本文が言語別に定義され en/ja で異なる", () => {
    const noticeKeys = [
      "fileNotFoundForMove",
      "fileNotFoundForOpen",
      "fileNotFoundForCompletion",
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

describe("messagesFor — 滞留バッジの i18n（#106 F9 AC5）", () => {
  it("messagesFor — stagnantBadge が経過日数を言語別に差し込む（英 Nd／日 N日）", () => {
    // given / when / then: 英は "21d"、日は "21日"（両言語で欠けなく定義）
    expect(messagesFor("en").stagnantBadge(21)).toBe("21d");
    expect(messagesFor("ja").stagnantBadge(21)).toBe("21日");
    expect(messagesFor("en").stagnantBadge(3)).toBe("3d");
    expect(messagesFor("ja").stagnantBadge(3)).toBe("3日");
  });

  it("messagesFor — stagnantLabel（aria-label）が経過日数を差し込み言語別（SR 読み上げ）", () => {
    // given / when
    const en = messagesFor("en").stagnantLabel(21);
    const ja = messagesFor("ja").stagnantLabel(21);
    // then: 経過日数を含み、両言語で異なる（片方欠けを検出）
    expect(en).toContain("21");
    expect(ja).toContain("21");
    expect(ja).not.toBe(en);
  });

  it("messagesFor — 両言語で滞留バッジ／ラベルが欠けなく定義されている（AC5 の欠けなし）", () => {
    for (const lang of ["en", "ja"] as Language[]) {
      const messages = messagesFor(lang);
      expect(messages.stagnantBadge(14).length).toBeGreaterThan(0);
      expect(messages.stagnantLabel(14).length).toBeGreaterThan(0);
    }
  });
});

describe("messagesFor — 診断バナー・軸名行の i18n（#103 F7）", () => {
  it("messagesFor — diagSharedAxisWarning が共有キーを差し込み言語別（原因＋直し方）", () => {
    const ja = messagesFor("ja").diagSharedAxisWarning("urgent");
    const en = messagesFor("en").diagSharedAxisWarning("urgent");
    // 共有キー（frontmatter キー）を実際に含む＝原因を名指しする
    expect(ja).toContain("urgent");
    expect(en).toContain("urgent");
    // 原因（共有キー）だけでなく「直し方」節も含む（AC4 の「原因＋直し方」両 clause を固定）
    expect(ja).toContain("別々");
    expect(en.toLowerCase()).toContain("different");
    // 非空・翻訳されている（同一文字列で取り残されていない）
    expect(ja.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);
    expect(ja).not.toBe(en);
  });

  it("messagesFor — diagAxisNames が緊急度/重要度の軸名を差し込み言語別", () => {
    const ja = messagesFor("ja").diagAxisNames("urgent", "important");
    const en = messagesFor("en").diagAxisNames("urgent", "important");
    expect(ja).toContain("urgent");
    expect(ja).toContain("important");
    expect(en).toContain("urgent");
    expect(en).toContain("important");
    expect(ja).not.toBe(en);
  });
});

describe("messagesFor — カード上の完了トグルの i18n（#105 F10・AC6 両言語欠けなし）", () => {
  it("messagesFor — チェックボタンの状態別ラベル（完了にする/未完了に戻す）が両言語で定義され異なる", () => {
    for (const lang of ["en", "ja"] as Language[]) {
      const messages = messagesFor(lang);
      expect(messages.completionToggle.length).toBeGreaterThan(0); // 未完了→完了にする
      expect(messages.completionToggleDone.length).toBeGreaterThan(0); // 完了→未完了に戻す
    }
    // 状態別で文言が異なる（同一 aria-label で「トグルの向き」が伝わらないのを防ぐ）
    expect(messagesFor("ja").completionToggle).not.toBe(messagesFor("ja").completionToggleDone);
    expect(messagesFor("en").completionToggle).not.toBe(messagesFor("en").completionToggleDone);
    // 翻訳されている（en/ja で異なる）
    expect(messagesFor("ja").completionToggle).not.toBe(messagesFor("en").completionToggle);
  });

  it("messagesFor — 完了トグルの結果アナウンス（成功/失敗）がノート名を差し込み言語別", () => {
    expect(messagesFor("ja").completionSucceeded("タスクA", true)).toContain("タスクA");
    expect(messagesFor("en").completionSucceeded("TaskA", true)).toContain("TaskA");
    expect(messagesFor("ja").completionFailed("タスクA")).toContain("タスクA");
    expect(messagesFor("en").completionFailed("TaskA")).toContain("TaskA");
    expect(messagesFor("ja").completionSucceeded("x", true)).not.toBe(
      messagesFor("en").completionSucceeded("x", true),
    );
  });

  it("messagesFor — 完了トグル成功は結果状態（完了/未完了）を含める（done で文言が変わる・レビュー指摘）", () => {
    // done=true と done=false で異なる文言（結果状態を SR に伝える）
    expect(messagesFor("ja").completionSucceeded("タスクA", true)).not.toBe(
      messagesFor("ja").completionSucceeded("タスクA", false),
    );
    expect(messagesFor("en").completionSucceeded("TaskA", true)).not.toBe(
      messagesFor("en").completionSucceeded("TaskA", false),
    );
  });

  it("messagesFor — 非 boolean 完了値の弾き Notice が両言語で定義され異なる（AC2）", () => {
    expect(messagesFor("ja").completionUnsupported.length).toBeGreaterThan(0);
    expect(messagesFor("en").completionUnsupported.length).toBeGreaterThan(0);
    expect(messagesFor("ja").completionUnsupported).not.toBe(messagesFor("en").completionUnsupported);
  });

  it("messagesFor — 設定タブの完了トグル文言（名前・説明・淡色トグル）が両言語で欠けなく定義される", () => {
    const completionKeys = [
      "completionName",
      "completionDesc",
      "dimCompletedName",
      "dimCompletedDesc",
    ] as const;
    for (const key of completionKeys) {
      expect(messagesFor("ja").settings[key].length).toBeGreaterThan(0);
      expect(messagesFor("en").settings[key].length).toBeGreaterThan(0);
      expect(messagesFor("ja").settings[key]).not.toBe(messagesFor("en").settings[key]);
    }
  });

  it("messagesFor — Configure view の完了セレクタ displayName が言語で切り替わる", () => {
    expect(messagesFor("ja").completionOption.length).toBeGreaterThan(0);
    expect(messagesFor("en").completionOption.length).toBeGreaterThan(0);
    expect(messagesFor("ja").completionOption).not.toBe(messagesFor("en").completionOption);
  });
});
