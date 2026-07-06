import { describe, expect, it } from "vitest";
import { nextAnnouncement } from "./liveStatus";

/**
 * liveStatus — aria-live 領域の文言差分化（純関数）。
 * 同一文言を続けて流しても DOM テキストが必ず変わり、スクリーンリーダーが再読み上げできること
 * を固定する（レビュー指摘: 同値 setState は Preact が再レンダリングを打ち切り読み上げが消える）。
 */

const ZWSP = String.fromCharCode(0x200b);

describe("nextAnnouncement", () => {
  it("nextAnnouncement — 空文言はそのまま空（初期状態）", () => {
    expect(nextAnnouncement("", "")).toBe("");
    expect(nextAnnouncement("前回" + ZWSP, "")).toBe("");
  });

  it("nextAnnouncement — 同一文言を連続で流しても live 文字列が必ず変わる（再読み上げ）", () => {
    // given / when: 同じメッセージを 2 回
    const first = nextAnnouncement("", "「会議メモ」を Schedule へ移動しました。");
    const second = nextAnnouncement(first, "「会議メモ」を Schedule へ移動しました。");
    // then: DOM テキストが差分化される
    expect(second).not.toBe(first);
  });

  it("nextAnnouncement — 表示テキスト本体は保たれ、差分は不可視のゼロ幅スペースのみ", () => {
    const out = nextAnnouncement("", "移動しました");
    // 本文はそのまま含み、付加されるのは ZWSP のみ（読み上げに影響しない）
    expect(out.replace(new RegExp(ZWSP, "g"), "")).toBe("移動しました");
    // 初回（prevLive="" は ZWSP 終端でない）は必ず ZWSP を 1 つ付ける契約を厳密に固定する。
    // 旧アサーション（`=== 本文 || === 本文+ZWSP`）はどちらでも真になり、初回付加の退行を捕捉できなかった（レビュー指摘 #8）。
    expect(out).toBe("移動しました" + ZWSP);
  });

  it("nextAnnouncement — 3 回連続でも毎回隣接が異なる（交互トグル）", () => {
    const a = nextAnnouncement("", "x");
    const b = nextAnnouncement(a, "x");
    const c = nextAnnouncement(b, "x");
    expect(b).not.toBe(a);
    expect(c).not.toBe(b);
  });
});
