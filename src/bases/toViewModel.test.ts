import { describe, expect, it } from "vitest";
import type { BasesEntry, BasesPropertyId, TFile, Value } from "obsidian";
import { BooleanValue, NullValue, NumberValue, StringValue } from "obsidian";
import { DEFAULT_SETTINGS } from "../settings";
import { messagesFor } from "../i18n";
import { toViewModel } from "./toViewModel";

/**
 * toViewModel — Bases の entries を Bases 非依存の MatrixViewModel へ変換する純関数。
 * #19（F2）で各 entry の両軸値を `getValue` で読み（absent は NullValue で区別）、
 * `classifyQuadrant` で 4 象限＋未分類に**事前グルーピング**（placements）する。
 * v1 は boolean 軸限定のため、値が `BooleanValue` の軸だけを 4 象限に分類し、非 boolean
 * （数値/文字列）や absent は未分類へ退避する（#34）。obsidian の値 import はスタブへ解決される。
 */

/**
 * absent を表す **実 NullValue**（singleton）。実機の absent は NullValue で `toString()` は
 * 文字列 "null"・`isTruthy()===false`（`scripts/e2e` プローブで確定）。判定は `instanceof NullValue`。
 */
const ABSENT: Value = NullValue.value;
/** boolean 軸の値（実 `BooleanValue`）。#34 で正規化を boolean 軸限定に狭めたため実インスタンスを使う。 */
const TRUE: Value = new BooleanValue(true);
const FALSE: Value = new BooleanValue(false);

/**
 * 実機 `TFile` を模した file スタブ。`extension` を path 末尾から導出し、md ノートと
 * 非 md（`.base` 自身・`.canvas`・画像）を区別できるようにする（md 限定フィルタの検証用）。
 */
function fileStub(
  path: string,
  basename?: string,
): Pick<TFile, "path" | "basename" | "extension"> {
  const dot = path.lastIndexOf(".");
  const extension = dot >= 0 ? path.slice(dot + 1) : "";
  return { path, basename: basename ?? path.replace(/\.[^.]+$/, ""), extension };
}

/** 両軸の値を指定した最小モック entry（軸プロパティは note.urgent / note.important）。 */
function mockEntry(
  path: string,
  basename: string,
  urgent: Value | null,
  important: Value | null,
): BasesEntry {
  const values: Record<string, Value | null> = {
    "note.urgent": urgent,
    "note.important": important,
  };
  return {
    file: fileStub(path, basename),
    getValue: (id: BasesPropertyId) => values[id] ?? null,
  } as unknown as BasesEntry;
}

describe("toViewModel — 状態とガード", () => {
  it("toViewModel — entries が 0 件なら state=empty・entries 空・placements 全空", () => {
    // given / when
    const viewModel = toViewModel([], null, DEFAULT_SETTINGS);
    // then
    expect(viewModel.state).toBe("empty");
    expect(viewModel.entries).toEqual([]);
    expect(viewModel.placements).toEqual({
      do: [],
      schedule: [],
      delegate: [],
      delete: [],
      unclassified: [],
    });
  });

  it("toViewModel — null/undefined を渡しても落ちず state=empty（防御的ガード）", () => {
    // given / when / then
    expect(toViewModel(null, null, DEFAULT_SETTINGS).state).toBe("empty");
    expect(toViewModel(undefined, null, DEFAULT_SETTINGS).state).toBe("empty");
  });
});

describe("toViewModel — 4 象限の配置（AC1-4）", () => {
  it("toViewModel — urgent=true,important=true は Do に配置", () => {
    // given
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when
    const { placements, state } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    expect(state).toBe("ready");
    expect(placements.do.map((e) => e.id)).toEqual(["a.md"]);
  });

  it("toViewModel — urgent=false,important=true は Schedule に配置", () => {
    const entries = [mockEntry("b.md", "b", FALSE, TRUE)];
    expect(
      toViewModel(entries, null, DEFAULT_SETTINGS).placements.schedule.map((e) => e.id),
    ).toEqual(["b.md"]);
  });

  it("toViewModel — urgent=true,important=false は Delegate に配置", () => {
    const entries = [mockEntry("c.md", "c", TRUE, FALSE)];
    expect(
      toViewModel(entries, null, DEFAULT_SETTINGS).placements.delegate.map((e) => e.id),
    ).toEqual(["c.md"]);
  });

  it("toViewModel — urgent=false,important=false は Delete に配置", () => {
    const entries = [mockEntry("d.md", "d", FALSE, FALSE)];
    expect(
      toViewModel(entries, null, DEFAULT_SETTINGS).placements.delete.map((e) => e.id),
    ).toEqual(["d.md"]);
  });
});

describe("toViewModel — absent / 未分類（AC5-6）", () => {
  it("toViewModel — 片方でも軸が absent なら未分類（false と区別・Delete に誤分類しない）", () => {
    // given: urgent が absent、important=false（false と混同してはならない）
    const entries = [mockEntry("x.md", "x", ABSENT, FALSE)];
    // when
    const { placements } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    expect(placements.unclassified.map((e) => e.id)).toEqual(["x.md"]);
    expect(placements.delete).toEqual([]);
  });

  it("toViewModel — 非 boolean 軸（数値 note.priority: 3 相当）のノートは未分類ゾーンに入る（v1 boolean 軸限定・#34 AC1/AC2）", () => {
    // given: 緊急軸が数値 NumberValue、重要軸は boolean。マトリクスを開くと…
    const entries = [mockEntry("num.md", "num", new NumberValue(3), TRUE)];
    // when
    const { placements } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: 非 boolean 軸のノートは 4 象限に並ばず未分類（ドラッグ→両軸 true/false 上書きでの破壊を防ぐ）
    expect(placements.unclassified.map((e) => e.id)).toEqual(["num.md"]);
    expect(
      placements.do.concat(placements.schedule, placements.delegate, placements.delete),
    ).toEqual([]);
  });

  it("toViewModel — 軸プロパティを持たない md ノート（両軸 absent）は未分類", () => {
    // given: getValue が両軸 null（プロパティ無し）の Markdown ノート
    const entries = [mockEntry("Inbox/no-axes.md", "no-axes", null, null)];
    // when
    const { placements } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    expect(placements.unclassified.map((e) => e.id)).toEqual(["Inbox/no-axes.md"]);
    // 4 象限のいずれにも誤配置されない
    expect(
      placements.do.concat(placements.schedule, placements.delegate, placements.delete),
    ).toEqual([]);
  });

  it("toViewModel — MatrixEntry は id/title と両軸値を持つ", () => {
    const entries = [mockEntry("Inbox/今日のタスク.md", "今日のタスク", TRUE, ABSENT)];
    const { entries: mapped } = toViewModel(entries, null, DEFAULT_SETTINGS);
    expect(mapped[0]).toEqual({
      id: "Inbox/今日のタスク.md",
      title: "今日のタスク",
      urgent: true,
      important: undefined,
    });
  });
});

describe("toViewModel — 非 Markdown（.base 自身・.canvas・画像等）の除外（要件 §9）", () => {
  it("toViewModel — .base 自己エントリはマトリクスに出さない（象限にも未分類にも入れない）", () => {
    // given: フィルタ無し時に Base 自身の .base ファイルが entries に混ざる
    const entries = [
      mockEntry("Tasks.base", "Tasks", null, null),
      mockEntry("todo.md", "todo", TRUE, TRUE),
    ];
    // when
    const { placements, entries: mapped } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: .base は entries・全 placements から除外され、md ノートだけが残る
    expect(mapped.map((e) => e.id)).toEqual(["todo.md"]);
    expect(placements.unclassified).toEqual([]);
    expect(placements.do.map((e) => e.id)).toEqual(["todo.md"]);
  });

  it("toViewModel — .canvas・画像等の非 md ノートも配置対象外（v1 は md frontmatter 軸のみ）", () => {
    // given
    const entries = [
      mockEntry("board.canvas", "board", null, null),
      mockEntry("photo.png", "photo", null, null),
    ];
    // when
    const { placements, entries: mapped } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: いずれもカード化されない
    expect(mapped).toEqual([]);
    expect(placements.unclassified).toEqual([]);
  });

  it("toViewModel — md ノートが 1 件も無い（.base のみ）Base は state=empty", () => {
    // given
    const entries = [mockEntry("Tasks.base", "Tasks", null, null)];
    // when
    const viewModel = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: 配置対象ゼロは空状態（empty プレースホルダを描画させる）
    expect(viewModel.state).toBe("empty");
    expect(viewModel.entries).toEqual([]);
  });

  it("toViewModel — 配列に null/undefined 要素が混じっても throw せず弾く（Bases 境界の防御）", () => {
    // given: 予期しない null/undefined 要素＋正常な md ノート
    const entries = [
      null as unknown as ReturnType<typeof mockEntry>,
      mockEntry("a.md", "a", TRUE, TRUE),
      undefined as unknown as ReturnType<typeof mockEntry>,
    ];
    // when / then: null/undefined は isPlaceableNote が弾き、正常ノートだけ配置される（クラッシュしない）
    const { placements, entries: mapped } = toViewModel(entries, null, DEFAULT_SETTINGS);
    expect(mapped.map((e) => e.id)).toEqual(["a.md"]);
    expect(placements.do.map((e) => e.id)).toEqual(["a.md"]);
  });
});

describe("toViewModel — 非 boolean 軸カードのロック（ドラッグ不可フラグ・データ破壊防止）", () => {
  it("toViewModel — 非 boolean（数値）軸を持つ未分類カードは locked=true", () => {
    // given: 緊急軸が数値、重要軸は boolean → 未分類（#34）だが、ドロップ上書きで数値破壊しうる
    const entries = [mockEntry("num.md", "num", new NumberValue(3), TRUE)];
    // when
    const { placements } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: 未分類に入り、locked=true（UI がドラッグ不可＋視覚マークにする）
    const card = placements.unclassified.find((e) => e.id === "num.md");
    expect(card?.locked).toBe(true);
  });

  it("toViewModel — important 軸だけが非 boolean（数値）でも locked=true（対称・|| 第2オペランド）", () => {
    // given: urgent=false(boolean)・important=数値 → 未分類だが important 側が破壊対象
    const entries = [mockEntry("imp.md", "imp", FALSE, new NumberValue(3))];
    // when
    const { placements } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    const card = placements.unclassified.find((e) => e.id === "imp.md");
    expect(card?.locked).toBe(true);
  });

  it("toViewModel — 軸 absent の md ノートは locked を付けない（分類として書けるのでドラッグ可）", () => {
    // given: 両軸 absent（欠損）。ドロップは両軸を新規に true/false 書き込みするだけで破壊しない
    const entries = [mockEntry("x.md", "x", ABSENT, ABSENT)];
    // when
    const { placements } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: 未分類だが locked は付かない（ドラッグして分類できる）
    const card = placements.unclassified.find((e) => e.id === "x.md");
    expect(card?.locked).toBeUndefined();
  });

  it("toViewModel — boolean 軸で象限配置されたカードは locked を付けない", () => {
    // given
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when / then
    expect(toViewModel(entries, null, DEFAULT_SETTINGS).placements.do[0].locked).toBeUndefined();
  });

  it("toViewModel — 両軸が同一キー設定のとき、象限配置された boolean カードも locked=true（掴めるのに必ず失敗する状態の封鎖・レビュー指摘）", () => {
    // given: 緊急・重要の両方に同じ note.urgent を割り当てた設定ミス。両軸が同値になり do に載って掴めるが、
    //        書き戻しは resolveWritableAxisKeys の urgent===important ガードで毎回失敗する。
    const sameKeyConfig = {
      getAsPropertyId: (key: string): BasesPropertyId | null =>
        key === "urgentProperty" || key === "importantProperty"
          ? ("note.urgent" as BasesPropertyId)
          : null,
    };
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when
    const { placements } = toViewModel(entries, sameKeyConfig, DEFAULT_SETTINGS);
    // then: do 象限に載るが locked=true（UI がドラッグ不可にして無駄な失敗ループを防ぐ）
    const card = placements.do.find((e) => e.id === "a.md");
    expect(card?.locked).toBe(true);
  });

  it("toViewModel — 両軸同一キーのとき未分類カードにも locked=true が一貫して付く（象限に関わらず全カードをロック）", () => {
    // given: 両軸に同じ note.urgent を割り当て、その軸が absent のカード（両軸 absent → 未分類）
    const sameKeyConfig = {
      getAsPropertyId: (key: string): BasesPropertyId | null =>
        key === "urgentProperty" || key === "importantProperty"
          ? ("note.urgent" as BasesPropertyId)
          : null,
    };
    const entries = [mockEntry("u.md", "u", ABSENT, ABSENT)];
    // when
    const { placements } = toViewModel(entries, sameKeyConfig, DEFAULT_SETTINGS);
    // then: 未分類ゾーンのカードにも locked が付く（同一キーは象限に関わらず全カード一律ロック）
    const card = placements.unclassified.find((e) => e.id === "u.md");
    expect(card?.locked).toBe(true);
  });
});

describe("toViewModel — 数百件スケール（純パイプラインの回帰ガード）", () => {
  it("toViewModel — 500 件を漏れなく正しい 4 象限へ分類する（大量入力の正しさ）", () => {
    // given: 4 象限に均等な 500 件の md ノート（i%4 で urgent/important を割り振る）
    const entries = Array.from({ length: 500 }, (_, i) =>
      mockEntry(`note-${i}.md`, `note-${i}`, i % 2 === 0 ? TRUE : FALSE, i % 4 < 2 ? TRUE : FALSE),
    );
    // when
    const { state, placements, entries: mapped } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: 全件が象限に載り、未分類は空
    expect(state).toBe("ready");
    expect(mapped).toHaveLength(500);
    const classified =
      placements.do.length +
      placements.schedule.length +
      placements.delegate.length +
      placements.delete.length;
    expect(classified).toBe(500);
    expect(placements.unclassified).toHaveLength(0);
    // 各象限へ均等（i%4 の割り付けどおり）に載ることまで固定し、大量入力での取りこぼし/誤分類を捕らえる。
    // 以前は wall-clock（elapsedMs < 500ms）で O(n^2) 退行を狙ったが、共有 CI のスロットルで偶発的に
    // 落ちる一方で軽度の非線形退行は捕らえられず「実質常に通るがフレーキー」だったため撤去した（レビュー指摘 #9）。
    // 性能退行の網はプロファイル/実機チェックリスト（docs/test/）に委ねる。
    expect(placements.do).toHaveLength(125);
    expect(placements.schedule).toHaveLength(125);
    expect(placements.delegate).toHaveLength(125);
    expect(placements.delete).toHaveLength(125);
  });
});

describe("toViewModel — showUnclassified の反映（レビュー指摘）", () => {
  it("toViewModel — 設定 showUnclassified を ViewModel に伝える（既定 true / false 設定）", () => {
    // given
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when / then: UI が未分類ゾーンの表示可否を判断できるよう flag を載せる
    expect(toViewModel(entries, null, DEFAULT_SETTINGS).showUnclassified).toBe(true);
    expect(
      toViewModel(entries, null, { ...DEFAULT_SETTINGS, showUnclassified: false })
        .showUnclassified,
    ).toBe(false);
  });

  it("toViewModel — empty 状態でも showUnclassified を伝える", () => {
    expect(
      toViewModel([], null, { ...DEFAULT_SETTINGS, showUnclassified: false })
        .showUnclassified,
    ).toBe(false);
  });
});

describe("toViewModel — ビュー options の軸変更で再配置（#21 F4・AC4）", () => {
  /** 任意キーの note.* プロパティを持つ entry（軸変更の検証用）。 */
  function entryWith(
    path: string,
    values: Record<string, Value | null>,
  ): BasesEntry {
    return {
      file: fileStub(path),
      getValue: (id: BasesPropertyId) => values[id] ?? null,
    } as unknown as BasesEntry;
  }
  /** ビュー options（config.getAsPropertyId）のモック。 */
  function mockConfig(
    map: Record<string, BasesPropertyId | null>,
  ): { getAsPropertyId: (key: string) => BasesPropertyId | null } {
    return { getAsPropertyId: (key: string) => map[key] ?? null };
  }

  it("toViewModel — options で軸を別 note.* に変えると新しい軸に基づき再配置される", () => {
    // given: ノートは note.due=true / note.priority=true を持つが note.urgent/important は absent
    const entries = [
      entryWith("t.md", {
        "note.due": TRUE,
        "note.priority": TRUE,
        "note.urgent": ABSENT,
        "note.important": ABSENT,
      }),
    ];
    // when: config を設定しない（デフォルト note.urgent/important）→ 両軸 absent で未分類
    const defaultView = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    expect(defaultView.placements.unclassified.map((e) => e.id)).toEqual(["t.md"]);
    expect(defaultView.placements.do).toEqual([]);

    // when: options で軸を note.due / note.priority に変更 → Do 象限へ再配置
    const remappedView = toViewModel(
      entries,
      mockConfig({
        urgentProperty: "note.due" as BasesPropertyId,
        importantProperty: "note.priority" as BasesPropertyId,
      }),
      DEFAULT_SETTINGS,
    );
    // then: 新しい軸で両軸 true → Do、未分類は空
    expect(remappedView.placements.do.map((e) => e.id)).toEqual(["t.md"]);
    expect(remappedView.placements.unclassified).toEqual([]);
  });
});

describe("toViewModel — presentation（ラベル/色/言語文言の解決・#23 F6）", () => {
  /** 両軸 boolean の最小 entry（presentation 検証は配置に依存しないため簡易版）。 */
  function boolEntry(path: string, urgent: Value, important: Value): BasesEntry {
    const values: Record<string, Value | null> = {
      "note.urgent": urgent,
      "note.important": important,
    };
    return {
      file: fileStub(path),
      getValue: (id: BasesPropertyId) => values[id] ?? null,
    } as unknown as BasesEntry;
  }

  it("toViewModel — 渡した messages と設定から presentation を組む（ready 状態）", () => {
    // given: do をカスタムラベル/色にした設定＋ en messages
    const settings = {
      ...DEFAULT_SETTINGS,
      quadrantLabels: { ...DEFAULT_SETTINGS.quadrantLabels, do: "やることA" },
      quadrantColors: { ...DEFAULT_SETTINGS.quadrantColors, do: "#123456" },
    };
    const messages = messagesFor("en");
    // when
    const viewModel = toViewModel([boolEntry("a.md", TRUE, TRUE)], null, settings, messages);
    // then: presentation にラベル（カスタム上書き・空は en 既定）・色・messages が載る
    expect(viewModel.presentation?.messages).toBe(messages);
    expect(viewModel.presentation?.quadrantLabels.do).toBe("やることA");
    expect(viewModel.presentation?.quadrantLabels.schedule).toBe("Schedule");
    expect(viewModel.presentation?.quadrantColors.do).toBe("#123456");
    expect(viewModel.presentation?.quadrantColors.schedule).toBe("");
  });

  it("toViewModel — empty 状態でも presentation を載せる（言語既定ラベル）", () => {
    // given / when: entries 0 件・ja messages
    const viewModel = toViewModel([], null, DEFAULT_SETTINGS, messagesFor("ja"));
    // then
    expect(viewModel.state).toBe("empty");
    expect(viewModel.presentation?.quadrantLabels.do).toBe("実行");
  });

  it("toViewModel — messages 省略時も presentation を持つ（後方互換の既定言語）", () => {
    // given / when: 3 引数呼び出し（既存呼び出しの後方互換）
    const viewModel = toViewModel([boolEntry("a.md", TRUE, TRUE)], null, DEFAULT_SETTINGS);
    // then: presentation は存在し全象限ラベルが埋まる
    expect(viewModel.presentation).toBeDefined();
    expect(viewModel.presentation?.quadrantLabels.delete.length).toBeGreaterThan(0);
  });
});

describe("toViewModel — 滞留インジケータ（mtime ヒューリスティック・#106 F9）", () => {
  const MS_PER_DAY = 86_400_000;
  /** 固定の「今日」（決定性のためアダプタから注入する。実機は Date.now()）。 */
  const NOW = 1_700_000_000_000;
  const daysAgo = (days: number): number => NOW - days * MS_PER_DAY;
  /** しきい値 14 の設定（既定と同値だが意図を明示）。 */
  const settingsWithThreshold = (days: number) => ({
    ...DEFAULT_SETTINGS,
    stagnationThresholdDays: days,
  });

  /** `stat.mtime` を持つ md ノートの entry（滞留判定は mtime を読む）。 */
  function mtimeEntry(
    path: string,
    mtime: number,
    urgent: Value = TRUE,
    important: Value = TRUE,
  ): BasesEntry {
    const values: Record<string, Value | null> = {
      "note.urgent": urgent,
      "note.important": important,
    };
    const dot = path.lastIndexOf(".");
    const extension = dot >= 0 ? path.slice(dot + 1) : "";
    return {
      file: {
        path,
        basename: path.replace(/\.[^.]+$/, ""),
        extension,
        stat: { mtime, ctime: mtime, size: 0 },
      },
      getValue: (id: BasesPropertyId) => values[id] ?? null,
    } as unknown as BasesEntry;
  }

  it("toViewModel — mtime が古いカードに stagnant=true・経過日数を載せる（AC1）", () => {
    // given: 21 日前更新・しきい値 14
    const entries = [mtimeEntry("old.md", daysAgo(21))];
    // when
    const { entries: mapped } = toViewModel(
      entries,
      null,
      settingsWithThreshold(14),
      messagesFor("en"),
      NOW,
    );
    // then: 滞留フラグと経過日数が載る（象限配置と両立）
    expect(mapped[0].stagnant).toBe(true);
    expect(mapped[0].stagnantDays).toBe(21);
  });

  it("toViewModel — 滞留カードも通常どおり象限に配置される（バッジは配置に影響しない）", () => {
    // given: 両軸 true で 21 日前
    const entries = [mtimeEntry("old.md", daysAgo(21), TRUE, TRUE)];
    // when
    const { placements } = toViewModel(
      entries,
      null,
      settingsWithThreshold(14),
      messagesFor("en"),
      NOW,
    );
    // then: Do 象限に載り、その card が滞留フラグを持つ
    const card = placements.do.find((e) => e.id === "old.md");
    expect(card?.stagnant).toBe(true);
  });

  it("toViewModel — しきい値内の新しいカードは stagnant を付けない（未設定）", () => {
    // given: 3 日前更新・しきい値 14
    const entries = [mtimeEntry("fresh.md", daysAgo(3))];
    // when
    const { entries: mapped } = toViewModel(
      entries,
      null,
      settingsWithThreshold(14),
      messagesFor("en"),
      NOW,
    );
    // then: 滞留でないカードにはフラグを付けない（locked? と同じ optional 流儀）
    expect(mapped[0].stagnant).toBeUndefined();
    expect(mapped[0].stagnantDays).toBeUndefined();
  });

  it("toViewModel — しきい値 0（オフ）ならどれだけ古くても stagnant を付けない", () => {
    // given: 365 日前・しきい値 0
    const entries = [mtimeEntry("ancient.md", daysAgo(365))];
    // when
    const { entries: mapped } = toViewModel(
      entries,
      null,
      settingsWithThreshold(0),
      messagesFor("en"),
      NOW,
    );
    // then
    expect(mapped[0].stagnant).toBeUndefined();
  });

  it("toViewModel — ビュー options のしきい値が設定既定を上書きする（ハイブリッド・#106）", () => {
    // given: 設定既定 14 だが options で 30 に上書き。21 日前のカードは 30 日しきい値では滞留しない。
    const config = {
      getAsPropertyId: () => null,
      get: (key: string) => (key === "stagnationThresholdDays" ? 30 : undefined),
    };
    const entries = [mtimeEntry("old.md", daysAgo(21))];
    // when
    const { entries: mapped } = toViewModel(
      entries,
      config,
      settingsWithThreshold(14),
      messagesFor("en"),
      NOW,
    );
    // then: options 30 が主＝21 日は超過せず滞留しない（設定既定 14 なら滞留だった）
    expect(mapped[0].stagnant).toBeUndefined();
  });

  it("toViewModel — stat.mtime を持たない entry は滞留判定を安全側（false）に倒す（境界防御）", () => {
    // given: stat を持たない旧来 file スタブ相当（Bases 境界の欠落）
    const entry = mockEntry("no-stat.md", "no-stat", TRUE, TRUE);
    // when
    const { entries: mapped } = toViewModel(
      [entry],
      null,
      settingsWithThreshold(14),
      messagesFor("en"),
      NOW,
    );
    // then: mtime が読めないカードは滞留させない（throw もしない）
    expect(mapped[0].stagnant).toBeUndefined();
  });
});

describe("toViewModel — カード追加プロパティ表示（バッジ・#104 F8）", () => {
  /** 任意プロパティ ID→Value を持つ md entry（バッジ検証用。両軸は boolean で Do に載る）。 */
  function badgeEntry(path: string, values: Record<string, Value | null>): BasesEntry {
    const merged: Record<string, Value | null> = {
      "note.urgent": TRUE,
      "note.important": TRUE,
      ...values,
    };
    return {
      file: fileStub(path),
      getValue: (id: BasesPropertyId) => merged[id] ?? null,
    } as unknown as BasesEntry;
  }
  /** ビュー options（config.getAsPropertyId）のモック。 */
  function mockConfig(
    map: Record<string, BasesPropertyId | null>,
  ): { getAsPropertyId: (key: string) => BasesPropertyId | null } {
    return { getAsPropertyId: (key: string) => map[key] ?? null };
  }

  it("toViewModel — カード表示プロパティ 2 個設定で各 MatrixEntry.badges に 2 件載る（AC1）", () => {
    // given: options で badgeProperty1/2 に note.due / note.project、ノートは両プロパティを持つ
    const entries = [
      badgeEntry("t.md", {
        "note.due": new StringValue("2026-07-01"),
        "note.project": new StringValue("仕事"),
      }),
    ];
    const config = mockConfig({
      badgeProperty1: "note.due" as BasesPropertyId,
      badgeProperty2: "note.project" as BasesPropertyId,
    });
    // when
    const { placements } = toViewModel(entries, config, DEFAULT_SETTINGS, messagesFor("en"), 1_700_000_000_000, "2026-07-09");
    // then: Do 象限のカードに badges が 2 件（解決済み {label,text}）
    const card = placements.do.find((e) => e.id === "t.md");
    expect(card?.badges).toHaveLength(2);
    expect(card?.badges?.[0]).toMatchObject({ label: "due", text: "2026-07-01" });
    expect(card?.badges?.[1]).toMatchObject({ label: "project", text: "仕事" });
  });

  it("toViewModel — 表示プロパティ 0 個（既定）なら badges は空（現状維持・AC3）", () => {
    // given / when: config 無し・設定 cardBadgeProperties=[]（既定）
    const entries = [badgeEntry("t.md", {})];
    const { placements, entries: mapped } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: badges は付かない（undefined・現状のカード密度）
    expect(placements.do[0].badges).toBeUndefined();
    expect(mapped[0].badges).toBeUndefined();
  });

  it("toViewModel — getValue が throw する軸のバッジは空表示へ退避しビュー全体は壊れない（AC2）", () => {
    // given: badge プロパティの getValue が throw（他プロパティは正常）
    const entry = {
      file: fileStub("t.md"),
      getValue: (id: BasesPropertyId) => {
        if (id === "note.urgent" || id === "note.important") return TRUE;
        throw new Error("boom");
      },
    } as unknown as BasesEntry;
    const config = mockConfig({ badgeProperty1: "note.due" as BasesPropertyId });
    // when
    const { state, placements } = toViewModel(entry ? [entry] : [], config, DEFAULT_SETTINGS, messagesFor("en"), 1_700_000_000_000, "2026-07-09");
    // then: ビューは ready のまま・カードは残り・バッジは空表示
    expect(state).toBe("ready");
    const card = placements.do.find((e) => e.id === "t.md");
    expect(card?.badges).toHaveLength(1);
    expect(card?.badges?.[0].text).toBe("");
  });

  it("toViewModel — 厳格 ISO 日付が今日以前 × 強調 on のバッジは emphasized=true（AC4）", () => {
    // given: note.due=2026-07-01（今日 2026-07-09 より前）・emphasizePastDates on
    const entries = [badgeEntry("t.md", { "note.due": new StringValue("2026-07-01") })];
    const config = mockConfig({ badgeProperty1: "note.due" as BasesPropertyId });
    const settings = { ...DEFAULT_SETTINGS, emphasizePastDates: true };
    // when
    const { placements } = toViewModel(entries, config, settings, messagesFor("en"), 1_700_000_000_000, "2026-07-09");
    // then
    const card = placements.do.find((e) => e.id === "t.md");
    expect(card?.badges?.[0].emphasized).toBe(true);
  });

  it("toViewModel — 設定 cardBadgeProperties をデフォルトに使う（options 未設定時）", () => {
    // given: options 無し・設定に note.due
    const entries = [badgeEntry("t.md", { "note.due": new StringValue("2026-07-01") })];
    const settings = { ...DEFAULT_SETTINGS, cardBadgeProperties: ["note.due"] };
    // when
    const { placements } = toViewModel(entries, null, settings, messagesFor("en"), 1_700_000_000_000, "2026-07-09");
    // then: 設定デフォルトのプロパティでバッジが載る
    const card = placements.do.find((e) => e.id === "t.md");
    expect(card?.badges).toHaveLength(1);
    expect(card?.badges?.[0]).toMatchObject({ label: "due", text: "2026-07-01" });
  });
});

describe("toViewModel — 診断情報（設定ミス診断・軸可視化・#103 F7）", () => {
  /** 緊急・重要の両方に同じ note.urgent を割り当てる設定ミス config。 */
  const sameKeyConfig = {
    getAsPropertyId: (key: string): BasesPropertyId | null =>
      key === "urgentProperty" || key === "importantProperty"
        ? ("note.urgent" as BasesPropertyId)
        : null,
  };
  /** 任意の軸プロパティ id を両軸に割り当てる config。 */
  function axisConfig(
    urgent: BasesPropertyId | null,
    important: BasesPropertyId | null,
  ): { getAsPropertyId: (key: string) => BasesPropertyId | null } {
    return {
      getAsPropertyId: (key: string) =>
        key === "urgentProperty" ? urgent : key === "importantProperty" ? important : null,
    };
  }

  it("toViewModel — 両軸が同一の書き戻し可能 note.* キーなら axesShareWritableKey=true・sharedAxisKey に共有キー（AC）", () => {
    // given: 緊急・重要の両方に note.urgent を割り当てた設定ミス
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when
    const { diagnostics } = toViewModel(entries, sameKeyConfig, DEFAULT_SETTINGS);
    // then: 設定ミス確定＋共有キー（frontmatter キー表記）が載る
    expect(diagnostics?.axesShareWritableKey).toBe(true);
    expect(diagnostics?.sharedAxisKey).toBe("urgent");
  });

  it("toViewModel — 両軸が異なる note.* キーなら axesShareWritableKey=false・urgentAxis/importantAxis に解決済み軸名（frontmatter キー・AC）", () => {
    // given: config=null → 設定デフォルト（urgent / important）
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when
    const { diagnostics } = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then
    expect(diagnostics?.axesShareWritableKey).toBe(false);
    expect(diagnostics?.urgentAxis).toBe("urgent");
    expect(diagnostics?.importantAxis).toBe("important");
    expect(diagnostics?.sharedAxisKey).toBeUndefined();
  });

  it("toViewModel — 空状態（entries 0 件）でも diagnostics に解決済み軸名が載る（空でも軸を提示・AC）", () => {
    // given / when: notes 0 件でも軸解決を行う（empty 分岐でも診断を計算する）
    const viewModel = toViewModel([], null, DEFAULT_SETTINGS);
    // then
    expect(viewModel.state).toBe("empty");
    expect(viewModel.diagnostics?.urgentAxis).toBe("urgent");
    expect(viewModel.diagnostics?.importantAxis).toBe("important");
    expect(viewModel.diagnostics?.axesShareWritableKey).toBe(false);
  });

  it("toViewModel — 空状態でも両軸同一キー設定ミスを検出する（バナーは empty でも出しうる）", () => {
    // given / when: notes 0 件 × 両軸同一キー
    const viewModel = toViewModel([], sameKeyConfig, DEFAULT_SETTINGS);
    // then
    expect(viewModel.state).toBe("empty");
    expect(viewModel.diagnostics?.axesShareWritableKey).toBe(true);
    expect(viewModel.diagnostics?.sharedAxisKey).toBe("urgent");
  });

  it('toViewModel — 非 note.*（formula.*）軸は生の property id をフォールバック表示する（"null" を出さない）', () => {
    // given: 緊急軸を formula.* に（書き戻し不可＝toFrontmatterKey は null）、重要軸は note.important
    const entries = [mockEntry("a.md", "a", TRUE, TRUE)];
    // when
    const { diagnostics } = toViewModel(
      entries,
      axisConfig("formula.due" as BasesPropertyId, "note.important" as BasesPropertyId),
      DEFAULT_SETTINGS,
    );
    // then: frontmatter キーが取れない軸は生 id を出す（"null" 文字列にしない）
    expect(diagnostics?.urgentAxis).toBe("formula.due");
    expect(diagnostics?.importantAxis).toBe("important");
    expect(diagnostics?.axesShareWritableKey).toBe(false);
  });
});

describe("toViewModel — カード上の完了トグル（#105 F10）", () => {
  /** 完了プロパティ note.done を持つ md ノート（軸は既定で Do＝true/true）。 */
  function completionEntry(
    path: string,
    done: Value | null,
    urgent: Value | null = new BooleanValue(true),
    important: Value | null = new BooleanValue(true),
  ): BasesEntry {
    const values: Record<string, Value | null> = {
      "note.urgent": urgent,
      "note.important": important,
      "note.done": done,
    };
    return {
      file: fileStub(path),
      getValue: (id: BasesPropertyId) => values[id] ?? null,
    } as unknown as BasesEntry;
  }

  const withCompletion = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({
    ...DEFAULT_SETTINGS,
    completionProperty: "done",
    ...over,
  });

  it("toViewModel — 完了プロパティ未設定（既定）は completionEnabled を立てず、カードに完了状態を付けない（opt-in）", () => {
    // given: 既定（completionProperty=""）
    const entries = [completionEntry("done.md", new BooleanValue(true))];
    // when
    const viewModel = toViewModel(entries, null, DEFAULT_SETTINGS);
    // then: 機能オフ＝チェックボタンを出さない・completed も付かない
    expect(viewModel.completionEnabled).toBeFalsy();
    expect(viewModel.entries[0].completed).toBeUndefined();
    expect(viewModel.entries[0].completionUnsupported).toBeUndefined();
  });

  it("toViewModel — 完了プロパティ有効時は completionEnabled=true と dimCompleted を ViewModel に載せる", () => {
    // given
    const entries = [completionEntry("a.md", new BooleanValue(false))];
    // when
    const viewModel = toViewModel(entries, null, withCompletion({ dimCompleted: true }));
    // then
    expect(viewModel.completionEnabled).toBe(true);
    expect(viewModel.dimCompleted).toBe(true);
  });

  it("toViewModel — done:true のカードは completed=true（淡色＋☑ 状態・AC4）", () => {
    const entries = [completionEntry("done.md", new BooleanValue(true))];
    const viewModel = toViewModel(entries, null, withCompletion());
    const card = viewModel.entries.find((e) => e.id === "done.md");
    expect(card?.completed).toBe(true);
  });

  it("toViewModel — done:false / done 未定義のカードは completed を付けない（未完了）", () => {
    const entries = [
      completionEntry("f.md", new BooleanValue(false)),
      completionEntry("absent.md", NullValue.value),
    ];
    const viewModel = toViewModel(entries, null, withCompletion());
    expect(viewModel.entries.find((e) => e.id === "f.md")?.completed).toBeUndefined();
    expect(viewModel.entries.find((e) => e.id === "absent.md")?.completed).toBeUndefined();
  });

  it("toViewModel — 非 boolean 完了値（日付=文字列/数値）は completionUnsupported=true（トグル無効・AC2）", () => {
    const entries = [
      completionEntry("date.md", new StringValue("2026-07-06")),
      completionEntry("num.md", new NumberValue(1)),
    ];
    const viewModel = toViewModel(entries, null, withCompletion());
    expect(viewModel.entries.find((e) => e.id === "date.md")?.completionUnsupported).toBe(true);
    expect(viewModel.entries.find((e) => e.id === "num.md")?.completionUnsupported).toBe(true);
    // 非 boolean は completed にしない（true 上書きで破壊しないよう無効化するだけ）
    expect(viewModel.entries.find((e) => e.id === "date.md")?.completed).toBeUndefined();
  });

  it("toViewModel — 完了プロパティが軸と同一キーなら機能無効（3 キー衝突ガード・AC3）", () => {
    // given: completionProperty が緊急軸（既定 note.urgent）と同一
    const entries = [completionEntry("x.md", new BooleanValue(true))];
    // when
    const viewModel = toViewModel(entries, null, withCompletion({ completionProperty: "urgent" }));
    // then: チェックボタンを出さない（掴めるのに壊す設定ミスを封鎖）
    expect(viewModel.completionEnabled).toBeFalsy();
    expect(viewModel.entries[0].completed).toBeUndefined();
  });
});
