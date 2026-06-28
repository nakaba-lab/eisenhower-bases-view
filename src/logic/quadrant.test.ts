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

  it("axisValuesForQuadrant — unclassified は書き戻し不可で null", () => {
    expect(axisValuesForQuadrant("unclassified")).toBeNull();
  });
});
