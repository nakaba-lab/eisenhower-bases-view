/**
 * ポップアウト別ウィンドウ対応の realm 堅牢 sensor（#44）。
 *
 * **背景（実機 Obsidian 1.12.7 で確定した真因）**: Obsidian がビューをポップアウトに出すと
 * leaf の DOM を別ウィンドウの document へ移動する（`adoptNode`）。Preact はカードを
 * **メイン window の `document.createElement*`** で生成するため、adopt 後もカードの
 * `ownerDocument` は popout を指す一方で **realm（prototype）はメインのまま**になる
 *（`card instanceof popoutWin.HTMLElement === false`）。dnd-kit の内部 `getOwnerDocument` は
 * `isHTMLElement = node instanceof getWindow(node).HTMLElement` が false だと**グローバル
 *（メイン）document へ fallback**するため、`PointerSensor`/`KeyboardSensor` が
 * `pointermove`/`pointerup`/`keydown` リスナーをメイン document に張ってしまい、popout の
 * ポインタ移動が届かず距離活性化（distance:5）に到達せず**ドラッグが開始しない＝掴めない**。
 *
 * **対策**: dnd-kit のセンサーを継承し、`super()` 後にリスナーのバインド先を
 * **イベントの realm から解決した正しい document**（`event.target.ownerDocument`＝実測で
 * popout を正しく指す。無ければ `event.view.document`）へ張り替える。dnd-kit の活性化ロジック
 *（距離活性化・handleMove/End）はそのまま流用するため、動作中のメイン window の掴みは無変更
 *（メインでは解決結果がメイン document と一致し**張り替えは no-op**）。
 *
 * dnd-kit の内部 `getOwnerDocument`（instanceof ガード）に手を入れられないための対症だが、
 * 掴み経路のバインド先だけを補正する最小介入で回帰面積を抑える。`@dnd-kit/core@6.3.x` に
 * バインドされる内部フィールド（`Listeners.target`/`.listeners`）へのアクセスは版固定で緩和し、
 * 形状が変わった場合は防御的に no-op へ縮退する（クラッシュさせない）。
 */
import { KeyboardSensor, PointerSensor } from "@dnd-kit/core";
import type {
  KeyboardSensorOptions,
  PointerSensorOptions,
  SensorProps,
} from "@dnd-kit/core";

/** 活性化イベントのうち document 解決に使う最小形（PointerEvent/KeyboardEvent 共通）。 */
interface EventLike {
  target?: EventTarget | null;
  view?: Window | null;
}

/**
 * リスナーを張るべき document を **instanceof に依存せず** 解決する（#44 の核）。
 *
 * `event.target.ownerDocument`（Element/Text は所属 document、popout に adopt 済みでも
 * 正しく popout を指す）→ target 自身が Document ならそれ → `event.view.document` →
 * `fallback`（＝dnd-kit が解決したメイン document）の順で決める。dnd-kit の `getOwnerDocument`
 * は cross-realm ノードで instanceof ガードを外してメインへ fallback するが、本関数は
 * `ownerDocument` を直接使うため popout を正しく解決する。
 */
export function resolveEventDocument(event: EventLike, fallback: Document): Document {
  const target = event.target as (Node & { ownerDocument?: Document | null }) | null | undefined;
  if (target) {
    if (target.ownerDocument) return target.ownerDocument;
    // target 自身が Document ノード（nodeType 9）の場合
    if (target.nodeType === 9) return target as unknown as Document;
  }
  const viewDoc = event.view?.document;
  if (viewDoc) return viewDoc;
  return fallback;
}

/** dnd-kit `Listeners` の再ターゲットに使う内部形状（版固定・防御的に扱う）。 */
export interface RetargetableListeners {
  target?: EventTarget | null;
  listeners?: Array<[string, EventListener, unknown]>;
  add?: (name: string, handler: EventListener, options?: unknown) => void;
  removeAll?: () => void;
}

/** dnd-kit センサーの内部フィールド（公開型に無いため最小宣言）。 */
export interface SensorInternals {
  document?: Document;
  listeners?: RetargetableListeners;
  documentListeners?: RetargetableListeners;
}

/**
 * 既に `oldTarget` へ登録済みのリスナー群を、同じハンドラ・options のまま `newTarget` へ張り替える。
 * メイン window（既に正しい document）や dnd-kit の内部形状が変わった場合は no-op（無害）。
 *
 * なお `KeyboardSensor` は keydown を `setTimeout` で**遅延登録**するため、retarget 実行時点で
 * `listeners.listeners` が空のこともある。その場合も `.target` を popout へ再ポイントしておけば、
 * 後で発火する遅延 `add` が新しい target（popout document）を使うため機能上正しく成立する。
 */
export function retargetListeners(
  listeners: RetargetableListeners | undefined,
  newTarget: Document,
): void {
  if (!listeners || listeners.target === newTarget) return;
  if (
    !Array.isArray(listeners.listeners) ||
    typeof listeners.add !== "function" ||
    typeof listeners.removeAll !== "function"
  ) {
    return; // dnd-kit の内部形状が想定外＝安全側で触らない
  }
  const bound = listeners.listeners.slice();
  listeners.removeAll();
  listeners.target = newTarget;
  listeners.listeners = [];
  for (const [name, handler, options] of bound) {
    listeners.add(name, handler, options);
  }
}

/** 掴み用フォールバック document（現在アクティブな realm の document＝popout 対応）。 */
const globalDoc: Document | undefined =
  typeof activeDocument !== "undefined" ? activeDocument : undefined;

/**
 * dnd-kit センサーの move/up/keydown リスナーを、活性化イベントの realm から解決した
 * 正しい document へ張り替える（popout の時だけ発火し、メインでは no-op）。
 */
export function retargetSensorToEventRealm(sensor: SensorInternals, event: EventLike | undefined): void {
  if (!event) return;
  const fallback = sensor.document ?? (sensor.listeners?.target as Document | undefined) ?? globalDoc;
  if (!fallback) return;
  const correct = resolveEventDocument(event, fallback);
  retargetListeners(sensor.listeners, correct);
  retargetListeners(sensor.documentListeners, correct);
  if ("document" in sensor) sensor.document = correct;
}

/**
 * ポップアウト対応の PointerSensor（#44）。掴み（distance 活性化）のリスナーを
 * イベントの realm document へ張り替える。activators・活性化ロジックは dnd-kit のまま。
 */
export class PopoutPointerSensor extends PointerSensor {
  constructor(props: SensorProps<PointerSensorOptions>) {
    super(props);
    retargetSensorToEventRealm(this as unknown as SensorInternals, props.event);
  }
}

/**
 * ポップアウト対応の KeyboardSensor（#44）。キーボードドラッグのリスナーを
 * イベントの realm document へ張り替える（a11y をメイン window と対称に保つ）。
 */
export class PopoutKeyboardSensor extends KeyboardSensor {
  constructor(props: SensorProps<KeyboardSensorOptions>) {
    super(props);
    retargetSensorToEventRealm(this as unknown as SensorInternals, props.event);
  }
}
