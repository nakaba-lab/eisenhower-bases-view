import { describe, it, expect } from "vitest";
import {
  resolveEventDocument,
  retargetListeners,
  retargetSensorToEventRealm,
  type RetargetableListeners,
  type SensorInternals,
} from "./popoutSensors";

/** dnd-kit `Listeners` を模したフェイク（`add`/`removeAll`/`listeners` 配列）。 */
function fakeListeners(
  target: EventTarget | null,
  entries: Array<[string, EventListener, unknown]> = [],
): RetargetableListeners & { removedCount: number } {
  const l = {
    target,
    listeners: entries.slice(),
    removedCount: 0,
    add(name: string, handler: EventListener, options?: unknown) {
      this.listeners!.push([name, handler, options as unknown as never]);
    },
    removeAll() {
      this.removedCount++;
    },
  };
  return l;
}

/**
 * #44: ポップアウト別ウィンドウのカードは Preact がメイン realm で生成し `adoptNode` で
 * popout document に移されるため、`ownerDocument===popout` だが realm はメイン
 *（`card instanceof popoutWin.HTMLElement === false`）。dnd-kit の `getOwnerDocument` は
 * この instanceof ガードが false だとグローバル（メイン）document へ fallback し、
 * sensor が move/up をメイン document に張って掴めなくなる。
 *
 * `resolveEventDocument` は **instanceof に依存せず** `event.target.ownerDocument`
 *（無ければ `event.view.document`）から listener を張るべき document を解決する純関数。
 * これがバグの核（誤った document 解決）を回避する。
 */
describe("resolveEventDocument — #44 popout の realm 跨ぎ document 解決", () => {
  it("target が別 document のノードなら、その ownerDocument を返す（instanceof 非依存）", () => {
    // given: メインとは別の document（popout を模す）に属するカード
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    const card = popoutDoc.createElement("div");
    popoutDoc.body.appendChild(card);
    // when / then: fallback（メイン document）ではなく card の ownerDocument を返す
    expect(resolveEventDocument({ target: card }, document)).toBe(popoutDoc);
    expect(resolveEventDocument({ target: card }, document)).not.toBe(document);
  });

  it("target が無く view があれば view.document を返す", () => {
    // given: target 欠落・view（popout window 相当）あり
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    const fakeView = { document: popoutDoc } as unknown as Window;
    // when / then
    expect(resolveEventDocument({ target: null, view: fakeView }, document)).toBe(popoutDoc);
  });

  it("target が Document 自身ならそれを返す", () => {
    // given: target が document ノード
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    // when / then
    expect(resolveEventDocument({ target: popoutDoc }, document)).toBe(popoutDoc);
  });

  it("target も view も解決できなければ fallback を返す", () => {
    // given / when / then: 何も解決できない場合はメイン document（fallback）
    expect(resolveEventDocument({ target: null }, document)).toBe(document);
    expect(resolveEventDocument({}, document)).toBe(document);
  });

  it("メイン window（target=メイン realm のノード）でも ownerDocument をそのまま返す（回帰なし）", () => {
    // given: メイン document のノード（現行動作の維持を固定）
    const card = document.createElement("div");
    document.body.appendChild(card);
    // when / then: メインでは ownerDocument===fallback で挙動不変
    expect(resolveEventDocument({ target: card }, document)).toBe(document);
    card.remove();
  });
});

describe("retargetListeners — リスナーを新 document へ張り替える中核", () => {
  it("旧 target から外し、新 target へ同ハンドラ・options のまま再登録する（リーク/二重登録なし）", () => {
    // given: メイン document を指すリスナー群（move は passive:false・up は options なし）
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    const handler: EventListener = () => {};
    const listeners = fakeListeners(document, [
      ["pointermove", handler, { passive: false }],
      ["pointerup", handler, undefined],
    ]);
    // when
    retargetListeners(listeners, popoutDoc);
    // then: 旧 target から removeAll・target 差し替え・options 保持で再登録
    expect(listeners.removedCount).toBe(1);
    expect(listeners.target).toBe(popoutDoc);
    expect(listeners.listeners).toEqual([
      ["pointermove", handler, { passive: false }],
      ["pointerup", handler, undefined],
    ]);
  });

  it("既に正しい target なら早期 return（no-op・removeAll しない）", () => {
    // given: 既に popout を指すリスナー
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    const listeners = fakeListeners(popoutDoc, [["pointermove", () => {}, undefined]]);
    // when
    retargetListeners(listeners, popoutDoc);
    // then: 触らない
    expect(listeners.removedCount).toBe(0);
    expect(listeners.target).toBe(popoutDoc);
  });

  it("dnd-kit の内部形状が想定外（add/removeAll 欠落・listeners 非配列）なら安全に no-op（throw しない）", () => {
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    // add/removeAll が無い
    const broken1 = { target: document, listeners: [] } as unknown as RetargetableListeners;
    // listeners が配列でない
    const broken2 = {
      target: document,
      listeners: "nope",
      add() {},
      removeAll() {},
    } as unknown as RetargetableListeners;
    expect(() => retargetListeners(broken1, popoutDoc)).not.toThrow();
    expect(() => retargetListeners(broken2, popoutDoc)).not.toThrow();
    // 触っていない（target 不変）
    expect(broken1.target).toBe(document);
    expect(broken2.target).toBe(document);
  });

  it("undefined を渡しても no-op（throw しない）", () => {
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    expect(() => retargetListeners(undefined, popoutDoc)).not.toThrow();
  });
});

describe("retargetSensorToEventRealm — sensor の document/リスナーを event の realm へ補正", () => {
  it("popout（event.target が別 document）では listeners/documentListeners/document を popout へ補正", () => {
    // given: dnd-kit が誤ってメイン document に張った状態を模す
    const popoutDoc = document.implementation.createHTMLDocument("popout");
    const card = popoutDoc.createElement("div");
    popoutDoc.body.appendChild(card);
    const move: EventListener = () => {};
    const key: EventListener = () => {};
    const listeners = fakeListeners(document, [["pointermove", move, { passive: false }]]);
    const documentListeners = fakeListeners(document, [["keydown", key, undefined]]);
    const sensor: SensorInternals = { document, listeners, documentListeners };
    // when
    retargetSensorToEventRealm(sensor, { target: card });
    // then: 3 つとも popout を指す
    expect(sensor.document).toBe(popoutDoc);
    expect(listeners.target).toBe(popoutDoc);
    expect(documentListeners.target).toBe(popoutDoc);
    expect(listeners.removedCount).toBe(1);
    expect(documentListeners.removedCount).toBe(1);
  });

  it("メイン window（event.target が sensor.document と同じ realm）では no-op（回帰なし）", () => {
    // given: メイン document のカード
    const card = document.createElement("div");
    document.body.appendChild(card);
    const listeners = fakeListeners(document, [["pointermove", () => {}, undefined]]);
    const documentListeners = fakeListeners(document, [["keydown", () => {}, undefined]]);
    const sensor: SensorInternals = { document, listeners, documentListeners };
    // when
    retargetSensorToEventRealm(sensor, { target: card });
    // then: 触らない（張り替え無し）
    expect(sensor.document).toBe(document);
    expect(listeners.removedCount).toBe(0);
    expect(documentListeners.removedCount).toBe(0);
    card.remove();
  });

  it("event が undefined なら no-op（throw しない）", () => {
    const listeners = fakeListeners(document);
    const sensor: SensorInternals = { document, listeners };
    expect(() => retargetSensorToEventRealm(sensor, undefined)).not.toThrow();
    expect(listeners.removedCount).toBe(0);
  });
});
