import type { BasesEntry, BasesViewConfig } from "obsidian";
import { DEFAULT_SETTINGS, type EisenhowerSettings } from "../settings";
import { classifyQuadrant } from "../logic/quadrant";
import { messagesFor, type Messages } from "../i18n";
import { readAxisValues, resolveAxisPropertyIds } from "./readAxis";
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

export function toViewModel(
  entries: readonly BasesEntry[] | undefined | null,
  config?: Pick<BasesViewConfig, "getAsPropertyId"> | null,
  settings: EisenhowerSettings = DEFAULT_SETTINGS,
  messages: Messages = messagesFor("ja"),
): MatrixViewModel {
  // ラベル/色/言語文言を解決して UI へ渡す（#23 F6）。状態に依らず常に載せる。
  const presentation = resolvePresentation(settings, messages);

  // クエリ未初期化・失敗で data が undefined/null になっても落ちないよう防御する。
  if (!entries || entries.length === 0) {
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
  const mapped: MatrixEntry[] = entries.map((entry) => {
    const axis = readAxisValues(entry, ids);
    const quadrant = classifyQuadrant(axis);
    const matrixEntry: MatrixEntry = {
      id: entry.file.path,
      title: entry.file.basename,
      urgent: axis.urgent,
      important: axis.important,
    };
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
