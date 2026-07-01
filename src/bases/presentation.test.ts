import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type EisenhowerSettings } from "../settings";
import { messagesFor } from "../i18n";
import {
  resolvePresentation,
  resolveQuadrantColors,
  resolveQuadrantLabels,
} from "./presentation";

/**
 * presentation — 設定（カスタムラベル/色）と言語メッセージ（既定ラベル/色フォールバック）を
 * 合成して UI へ渡す表示情報（#23 F6・AC2）。
 *
 * ラベル: カスタム空＝言語既定にフォールバック、非空＝カスタム上書き（AC2 とラベル×言語の相互作用）。
 * 色: カスタム空＝空文字（UI 側でテーマ既定にフォールバック）、非空＝その hex。純関数＝単体で固定する。
 */

/** 象限ラベル/色をカスタムした設定を作るヘルパ。 */
function withCustom(
  labels: Partial<EisenhowerSettings["quadrantLabels"]>,
  colors: Partial<EisenhowerSettings["quadrantColors"]> = {},
): EisenhowerSettings {
  return {
    ...DEFAULT_SETTINGS,
    quadrantLabels: { ...DEFAULT_SETTINGS.quadrantLabels, ...labels },
    quadrantColors: { ...DEFAULT_SETTINGS.quadrantColors, ...colors },
  };
}

describe("resolveQuadrantLabels — カスタム or 言語既定（AC2/AC4）", () => {
  it("resolveQuadrantLabels — 全カスタム空なら言語既定（ja）を返す", () => {
    // given / when
    const labels = resolveQuadrantLabels(DEFAULT_SETTINGS, messagesFor("ja"));
    // then
    expect(labels).toEqual(messagesFor("ja").quadrantLabels);
    expect(labels.do).toBe("実行");
  });

  it("resolveQuadrantLabels — 非空カスタムは上書き、空キーは言語既定にフォールバック", () => {
    // given: do だけカスタム、他は空 → en 既定
    const settings = withCustom({ do: "やることリスト" });
    // when
    const labels = resolveQuadrantLabels(settings, messagesFor("en"));
    // then
    expect(labels.do).toBe("やることリスト"); // カスタム
    expect(labels.schedule).toBe("Schedule"); // en 既定
    expect(labels.delegate).toBe("Delegate");
    expect(labels.delete).toBe("Delete");
  });

  it("resolveQuadrantLabels — 言語切替は空項目の既定だけ変え、カスタムは保持", () => {
    // given: do をカスタム
    const settings = withCustom({ do: "MyDo" });
    // when: ja/en を切替
    const ja = resolveQuadrantLabels(settings, messagesFor("ja"));
    const en = resolveQuadrantLabels(settings, messagesFor("en"));
    // then: カスタム do は両言語で保持、空項目は各言語の既定
    expect(ja.do).toBe("MyDo");
    expect(en.do).toBe("MyDo");
    expect(ja.schedule).toBe("計画");
    expect(en.schedule).toBe("Schedule");
  });
});

describe("resolveQuadrantColors — カスタム hex or 空（テーマ既定）", () => {
  it("resolveQuadrantColors — 全カスタム空なら全キー空文字（テーマ既定にフォールバック）", () => {
    expect(resolveQuadrantColors(DEFAULT_SETTINGS)).toEqual({
      do: "",
      schedule: "",
      delegate: "",
      delete: "",
    });
  });

  it("resolveQuadrantColors — 非空はその hex、空はそのまま空文字", () => {
    const settings = withCustom({}, { do: "#e5786d", delete: "#8a8f98" });
    expect(resolveQuadrantColors(settings)).toEqual({
      do: "#e5786d",
      schedule: "",
      delegate: "",
      delete: "#8a8f98",
    });
  });
});

describe("resolvePresentation — messages・ラベル・色を束ねる", () => {
  it("resolvePresentation — messages と解決済みラベル/色を返す", () => {
    // given
    const settings = withCustom({ do: "実行!" }, { do: "#ff0000" });
    const messages = messagesFor("en");
    // when
    const presentation = resolvePresentation(settings, messages);
    // then
    expect(presentation.messages).toBe(messages);
    expect(presentation.quadrantLabels.do).toBe("実行!");
    expect(presentation.quadrantLabels.schedule).toBe("Schedule");
    expect(presentation.quadrantColors.do).toBe("#ff0000");
    expect(presentation.quadrantColors.schedule).toBe("");
  });
});
