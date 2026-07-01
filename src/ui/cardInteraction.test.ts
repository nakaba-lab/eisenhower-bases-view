import { describe, it, expect } from "vitest";
import { isOpenKey, openLeafIntent } from "./cardInteraction";

/**
 * cardInteraction — カードを「開く」導線の純ヘルパー（#22 F5）。
 *
 * 修飾キー→新タブ可否（AC2）と「開くキー＝Enter のみ」（AC4・Space はドラッグ掴みに予約）
 * を Bases/Obsidian・dnd-kit 非依存の純関数として切り出し単体テストする。
 * 実際の open/preview 往復（workspace 操作）と dnd-kit の実ドラッグは手動/結合で担保する。
 */

describe("openLeafIntent — 修飾キーから新タブ可否を決める（AC1/AC2）", () => {
  it("openLeafIntent_修飾キーなし_現在のリーフで開く（newLeaf=false）", () => {
    // given / when / then
    expect(openLeafIntent({})).toEqual({ newLeaf: false });
  });

  it("openLeafIntent_metaKey（mac Cmd）_新タブで開く（newLeaf=true）", () => {
    expect(openLeafIntent({ metaKey: true })).toEqual({ newLeaf: true });
  });

  it("openLeafIntent_ctrlKey（win Ctrl）_新タブで開く（newLeaf=true）", () => {
    expect(openLeafIntent({ ctrlKey: true })).toEqual({ newLeaf: true });
  });
});

describe("isOpenKey — 開くキーは Enter のみ（AC4・Space はドラッグ掴みに予約）", () => {
  it("isOpenKey_Enter_true", () => {
    expect(isOpenKey({ key: "Enter" })).toBe(true);
  });

  it("isOpenKey_Space_false（掴む＝ドラッグに予約）", () => {
    // KeyboardEvent の Space は key===" "（code は "Space"）。
    expect(isOpenKey({ key: " " })).toBe(false);
  });

  it("isOpenKey_その他キー_false", () => {
    expect(isOpenKey({ key: "a" })).toBe(false);
  });
});
