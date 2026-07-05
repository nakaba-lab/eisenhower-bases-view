/**
 * 軸プロパティ設定 UI の options 宣言（#21 F4）。
 *
 * `registerBasesView` の `options` に渡す**軸プロパティセレクタ**（緊急度・重要度）の純ビルダー。
 * Bases の Configure view はこの宣言から選択 UI を自動描画し、`filter`（書き戻し可能な `note.*` 判定＝
 * {@link isWritableAxisProperty}）を通ったプロパティだけを候補に出す（AC1）。
 *
 * `extends BasesView` 本体・`main.ts` の `registerBasesView` 呼び出しは obsidian ランタイム必須で
 * 単体テスト対象外のため、テスト可能な純度（`filter` 挙動・option キー・`type`）を本モジュールへ逃がす
 *（`registerView.ts` の `safeRegisterBasesView` と同じ「純ラッパを切り出す」流儀）。
 *
 * 軸許容ルールの真実源は `readAxis.isWritableAxisProperty`（読み取り・書き戻しと同一述語を共有）。
 */
import type { BasesPropertyOption } from "obsidian";
import type { Messages } from "../i18n";
import {
  IMPORTANT_OPTION_KEY,
  URGENT_OPTION_KEY,
  isWritableAxisProperty,
} from "./readAxis";

/**
 * `registerBasesView` の `options`（`(config) => BasesAllOptions[]`）が返す軸プロパティセレクタ配列。
 *
 * 緊急度軸・重要度軸の 2 つを property セレクタとして宣言し、`filter` で書き戻し可能な `note.*` のみを
 * 選択候補にする（AC1）。`key` は {@link resolveAxisPropertyIds} が `config.getAsPropertyId(key)` で読む
 * キー（{@link URGENT_OPTION_KEY}／{@link IMPORTANT_OPTION_KEY}）と一致させ、ビュー options の選択値を
 * 軸解決へ橋渡しする。`displayName` は解決済み言語メッセージ（`messages.axisOption`）から出す（#23 F6 の
 * i18n をビュー文言だけでなく Configure view の軸セレクタにも及ぼす）。呼び出し側（`main.ts`）は
 * options 評価時点の `resolveMessages()` を渡し、言語設定に追従させる。
 */
export function buildAxisViewOptions(messages: Messages): BasesPropertyOption[] {
  return [
    {
      key: URGENT_OPTION_KEY,
      type: "property",
      displayName: messages.axisOption.urgency,
      placeholder: "note.urgent",
      filter: isWritableAxisProperty,
    },
    {
      key: IMPORTANT_OPTION_KEY,
      type: "property",
      displayName: messages.axisOption.important,
      placeholder: "note.important",
      filter: isWritableAxisProperty,
    },
  ];
}
