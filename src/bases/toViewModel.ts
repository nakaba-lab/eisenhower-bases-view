import type { BasesEntry, BasesViewConfig } from "obsidian";
import { DEFAULT_SETTINGS, type EisenhowerSettings } from "../settings";
import { classifyQuadrant } from "../logic/quadrant";
import { messagesFor, type Messages } from "../i18n";
import {
  axesShareWritableKey,
  hasUnsupportedAxisValue,
  readAxisValues,
  resolveAxisPropertyIds,
} from "./readAxis";
import { resolvePresentation } from "./presentation";
import { resolveStagnationThresholdDays } from "./stagnationThreshold";
import { evaluateStagnation } from "../logic/stagnation";
import type { MatrixEntry, MatrixViewModel, QuadrantPlacements } from "./types";

/**
 * `toViewModel` が受け取る config の最小形（軸解決 `getAsPropertyId` + 滞留しきい値解決 `get`）。
 * `get` は任意（既存呼び出し・軸のみの config／テストモックが `getAsPropertyId` だけでも通る）。
 */
type ViewConfigLike = Pick<BasesViewConfig, "getAsPropertyId"> &
  Partial<Pick<BasesViewConfig, "get">>;

/**
 * `entry.file.stat.mtime`（`TFile.stat.mtime`＝スパイク #16 で確定した安定コア API）を読む。
 * Bases 境界から `file`/`stat` 欠落・非数値が来ても throw せず `undefined`（滞留判定なし）へ倒す
 *（`isPlaceableNote` と同じ churn 耐性の境界防御）。
 */
function readMtime(entry: BasesEntry): number | undefined {
  const mtime = entry?.file?.stat?.mtime;
  return typeof mtime === "number" && Number.isFinite(mtime) ? mtime : undefined;
}

/**
 * Bases の entries を Bases 非依存の {@link MatrixViewModel} へ変換する純関数。
 *
 * #19（F2）: 各 entry の両軸値を `getValue` で読み（absent は NullValue で区別）、
 * `classifyQuadrant` で 4 象限＋未分類に**事前グルーピング**する（placements）。
 * 軸 propertyId はビュー options（主）＋設定デフォルトで解決する（{@link resolveAxisPropertyIds}）。
 *
 * `import type` のみで obsidian ランタイムに依存しないため単体テスト可能。
 */

/** 全象限を空配列で初期化した placements を作る（loading シェルの初期状態にも使う）。 */
export function emptyPlacements(): QuadrantPlacements {
  return { do: [], schedule: [], delegate: [], delete: [], unclassified: [] };
}

/**
 * 配置対象は **Markdown ノート（`file.extension === "md"`）のみ**（要件 §9）。
 *
 * Bases のクエリ結果には Base 自身の `.base` ファイルや `.canvas`・画像等の非ノートが
 * （フィルタ未設定時に）混ざりうる。v1 は boolean **frontmatter** 軸のみ扱うため、
 * frontmatter を持たない非 md はカード化せず（未分類ゾーンにも出さず）除外する。
 * これにより `.base` 自己エントリが未分類カードとして現れる混乱を防ぐ。
 */
function isPlaceableNote(entry: BasesEntry): boolean {
  // entry?.file?.extension: Bases 境界から予期しない要素（null/undefined・file 欠落）が混じっても
  // throw せず「配置対象外」として弾く（`isWritableAxisProperty` と同じ churn 耐性の境界防御）。
  return entry?.file?.extension === "md";
}

export function toViewModel(
  entries: readonly BasesEntry[] | undefined | null,
  config?: ViewConfigLike | null,
  settings: EisenhowerSettings = DEFAULT_SETTINGS,
  // messages 省略時は英語へフォールバックする（resolveLanguage の最終フォールバックが en＝
  // i18n の既定言語。実機ではアダプタが解決済みメッセージを常に渡す・レビュー指摘）。
  messages: Messages = messagesFor("en"),
  // 滞留判定の「今日」。決定性のためアダプタが実行時に注入する（実機は Date.now()・#106）。
  // 再計算は toViewModel 実行時のみ（開きっぱなしで日付境界を跨いでも次の再描画まで更新されない
  // ＝日単位粒度の割り切り。設計は docs/design/bases.md「滞留インジケータ」節）。
  now: number = Date.now(),
): MatrixViewModel {
  // ラベル/色/言語文言を解決して UI へ渡す（#23 F6）。状態に依らず常に載せる。
  const presentation = resolvePresentation(settings, messages);

  // クエリ未初期化・失敗で data が undefined/null になっても落ちないよう防御する。
  // 非 Markdown（.base 自身・.canvas・画像等）は配置対象外のため事前に除外する（要件 §9）。
  const notes = entries ? entries.filter(isPlaceableNote) : [];
  if (notes.length === 0) {
    return {
      state: "empty",
      entries: [],
      placements: emptyPlacements(),
      showUnclassified: settings.showUnclassified,
      presentation,
    };
  }

  const ids = resolveAxisPropertyIds(config, settings);
  // 両軸が同一 note.* キー（設定ミス）だと書き戻しが必ず失敗するため、当該ビューの全カードを
  // ドラッグ不可にして「掴めるのに必ず失敗する」状態を作らない（書込前ガードと対称・レビュー指摘）。
  const sameAxisKey = axesShareWritableKey(ids);
  // 滞留しきい値を解決する（ビュー options 主・設定既定フォールバック＝ハイブリッド・#106）。
  // 全カードで共通のため map の外で 1 度だけ解決する（0 は機能オフ）。
  const stagnationThresholdDays = resolveStagnationThresholdDays(config, settings);
  const placements = emptyPlacements();
  const mapped: MatrixEntry[] = notes.map((entry) => {
    const axis = readAxisValues(entry, ids);
    const quadrant = classifyQuadrant(axis);
    const matrixEntry: MatrixEntry = {
      id: entry.file.path,
      title: entry.file.basename,
      urgent: axis.urgent,
      important: axis.important,
    };
    // 書込可能 note.* 軸に非 boolean 値を持つカード、または両軸が同一キー設定のカードは、ドロップの
    // 両軸 true/false 上書きが破壊/必ず失敗になるためドラッグ不可にする（UI が印を付ける）。
    if (sameAxisKey || hasUnsupportedAxisValue(entry, ids)) matrixEntry.locked = true;
    // 滞留判定（#106・読み取り専用）: mtime が読め、しきい値超過なら滞留フラグと経過日数を載せる。
    // 非滞留・mtime 欠落は付けない（`locked?` と同じ optional 流儀）。
    const mtime = readMtime(entry);
    if (mtime !== undefined) {
      const stagnation = evaluateStagnation(mtime, now, stagnationThresholdDays);
      if (stagnation.stagnant) {
        matrixEntry.stagnant = true;
        matrixEntry.stagnantDays = stagnation.days;
      }
    }
    placements[quadrant].push(matrixEntry);
    return matrixEntry;
  });

  return {
    state: "ready",
    entries: mapped,
    placements,
    showUnclassified: settings.showUnclassified,
    presentation,
  };
}
