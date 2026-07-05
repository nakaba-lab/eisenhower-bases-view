/**
 * Bases カスタムビューの識別子と、登録呼び出しを graceful に包む純ラッパ。
 *
 * `safeRegisterBasesView` は obsidian ランタイムに依存しない（register を
 * コールバックで受ける）ため単体テスト可能。実際の `plugin.registerBasesView`
 * 呼び出しと `BasesView` サブクラスの配線は `src/main.ts` が行う（手動/結合で担保）。
 */

/** ビュー型 ID。コミュニティ申請後は変更不可のため安定値に固定する。 */
export const VIEW_ID = "eisenhower-matrix";
/** Bases の view selector に出る表示名。 */
export const VIEW_NAME = "Eisenhower Matrix";
/** view selector のアイコン（Obsidian 同梱アイコン ID）。 */
export const VIEW_ICON = "layout-grid";

/**
 * `register`（= `plugin.registerBasesView(...)`）を呼び、Bases 無効（false 返却）や
 * API 例外でもプラグインを壊さず graceful に処理して登録可否を返す（AC2）。
 *
 * @param register 登録を実行し boolean を返すコールバック。
 * @param onUnavailable Bases 無効・例外時に呼ぶ副作用（log/Notice 等）。
 * @returns 登録に成功したら true、無効/例外なら false。
 */
export function safeRegisterBasesView(
  register: () => boolean,
  onUnavailable?: () => void,
): boolean {
  try {
    const registered = register();
    if (registered === false) {
      onUnavailable?.();
      return false;
    }
    return true;
  } catch (error) {
    console.error("[Eisenhower Matrix] registerBasesView failed", error);
    onUnavailable?.();
    return false;
  }
}
