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
  COMPLETION_OPTION_KEY,
  IMPORTANT_OPTION_KEY,
  URGENT_OPTION_KEY,
  isWritableAxisProperty,
} from "./readAxis";
import { BADGE_OPTION_KEYS } from "./readBadges";

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

/**
 * `registerBasesView` の `options` が返す**カードバッジプロパティセレクタ**配列（#104 F8・読み取り専用）。
 *
 * カードにバッジ表示する追加プロパティを最大 {@link MAX_BADGE_PROPERTIES} 個、property セレクタとして
 * 宣言する（`key`＝`badgeProperty1..N`＝{@link BADGE_OPTION_KEYS}。`resolveBadgePropertyIds` が読むキーと
 * 一致させる）。軸セレクタ（`buildAxisViewOptions`）と違い**読み取り専用サーフェス**のため `filter` は
 * `note.*` に限定せず**全プロパティを許可**する（`formula.*`／`file.*` も選べる）。`displayName` は解決済み
 * 言語メッセージ（`messages.badgeOption(n)`）から出す（軸セレクタと同じく Configure view の i18n を及ぼす）。
 * 常に {@link MAX_BADGE_PROPERTIES} 個を宣言する（可変個数を要する呼び出し元は無い＝可変 count は導入しない・レビュー指摘）。
 */
export function buildBadgeViewOptions(messages: Messages): BasesPropertyOption[] {
  return BADGE_OPTION_KEYS.map((key, index) => ({
    key,
    type: "property",
    displayName: messages.badgeOption(index + 1),
    filter: () => true,
  }));
}

/**
 * `registerBasesView` の `options` が返す**完了プロパティセレクタ**（#105 F10）。
 *
 * カード上の完了トグルの書き戻し先を選ぶ property セレクタを 1 つ宣言する（`key`＝
 * {@link COMPLETION_OPTION_KEY}＝{@link resolveCompletionId} が読むキーと一致）。完了は frontmatter へ
 * `true/false` を**書き戻す**ため、軸セレクタと同じく `filter` は書き戻し可能な `note.*` に限定する
 *（読み取り専用のバッジセレクタと異なり `formula.*`／`file.*` は選べない）。`displayName` は解決済み
 * 言語メッセージ（`messages.completionOption`）から出す（軸/バッジと同じく Configure view の i18n を及ぼす）。
 */
export function buildCompletionViewOption(messages: Messages): BasesPropertyOption {
  return {
    key: COMPLETION_OPTION_KEY,
    type: "property",
    displayName: messages.completionOption,
    placeholder: "note.done",
    filter: isWritableAxisProperty,
  };
}
