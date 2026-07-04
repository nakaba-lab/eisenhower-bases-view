import type { BasesEntry, BasesViewConfig } from "obsidian";
import { DEFAULT_SETTINGS, type EisenhowerSettings } from "../settings";
import { classifyQuadrant } from "../logic/quadrant";
import { messagesFor, type Messages } from "../i18n";
import {
  hasUnsupportedAxisValue,
  readAxisValues,
  resolveAxisPropertyIds,
} from "./readAxis";
import { resolvePresentation } from "./presentation";
import type { MatrixEntry, MatrixViewModel, QuadrantPlacements } from "./types";

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
  config?: Pick<BasesViewConfig, "getAsPropertyId"> | null,
  settings: EisenhowerSettings = DEFAULT_SETTINGS,
  messages: Messages = messagesFor("ja"),
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
    // 書込可能 note.* 軸に非 boolean 値を持つカードは、ドロップの両軸 true/false 上書きで
    // 元値を破壊するためドラッグ不可にする（UI が印を付ける）。true のときだけ載せる（欠損カードには付けない）。
    if (hasUnsupportedAxisValue(entry, ids)) matrixEntry.locked = true;
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
