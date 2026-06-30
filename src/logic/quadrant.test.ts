import { describe, it, expect } from "vitest";
import { classifyQuadrant, axisValuesForQuadrant, type Quadrant } from "./quadrant";

describe("classifyQuadrant", () => {
  const cases: Array<{
    name: string;
    urgent: boolean | undefined;
    important: boolean | undefined;
    expected: Quadrant;
  }> = [
    { name: "重要かつ緊急なら do", urgent: true, important: true, expected: "do" },
    { name: "重要だが緊急でないなら schedule", urgent: false, important: true, expected: "schedule" },
    { name: "緊急だが重要でないなら delegate", urgent: true, important: false, expected: "delegate" },
    { name: "緊急でも重要でもないなら delete", urgent: false, important: false, expected: "delete" },
    { name: "緊急度が欠損なら unclassified", urgent: undefined, important: true, expected: "unclassified" },
    { name: "重要度が欠損なら unclassified", urgent: true, important: undefined, expected: "unclassified" },
    {
      name: "両軸欠損なら unclassified（明示的 false と区別）",
      urgent: undefined,
      important: undefined,
      expected: "unclassified",
    },
  ];

  for (const c of cases) {
    it(`classifyQuadrant — ${c.name}`, () => {
      // given / when
      const result = classifyQuadrant({ urgent: c.urgent, important: c.important });
      // then
      expect(result).toBe(c.expected);
    });
  }
});

describe("axisValuesForQuadrant", () => {
  it("axisValuesForQuadrant — do は両軸 true を返す", () => {
    // given / when / then
    expect(axisValuesForQuadrant("do")).toEqual({ urgent: true, important: true });
  });

  it("axisValuesForQuadrant — schedule は緊急 false・重要 true を返す", () => {
    expect(axisValuesForQuadrant("schedule")).toEqual({ urgent: false, important: true });
  });

  // delegate / delete は schedule の鏡像で取り違えやすい（片軸だけ true）。
  // ここを欠くと、誤った軸値（例: delegate→schedule 相当）を frontmatter に書き戻す
  // データ破壊が単体で無検出になるため、4 実象限すべてを固定する（レビュー指摘）。
  it("axisValuesForQuadrant — delegate は緊急 true・重要 false を返す", () => {
    expect(axisValuesForQuadrant("delegate")).toEqual({ urgent: true, important: false });
  });

  it("axisValuesForQuadrant — delete は両軸 false を返す", () => {
    expect(axisValuesForQuadrant("delete")).toEqual({ urgent: false, important: false });
  });

  it("axisValuesForQuadrant — unclassified は書き戻し不可で null", () => {
    expect(axisValuesForQuadrant("unclassified")).toBeNull();
  });
});

describe("classifyQuadrant ∘ axisValuesForQuadrant — 4 実象限の往復整合", () => {
  // ドラッグ書き戻しの正しさの要: 象限→軸値（書き込み）→象限（再分類）が一巡で元に戻る。
  // どちらかの写像が壊れると分類とドラッグ結果が食い違うため、テーブル駆動で固定する。
  const realQuadrants: Quadrant[] = ["do", "schedule", "delegate", "delete"];
  for (const q of realQuadrants) {
    it(`往復 — ${q} は axisValuesForQuadrant→classifyQuadrant で ${q} に戻る`, () => {
      // given
      const axis = axisValuesForQuadrant(q);
      // when / then: 実象限は必ず両軸 boolean（null にならない）
      expect(axis).not.toBeNull();
      expect(classifyQuadrant(axis!)).toBe(q);
    });
  }
});
