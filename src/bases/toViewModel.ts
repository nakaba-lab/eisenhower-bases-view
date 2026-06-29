import type { BasesEntry } from "obsidian";
import type { MatrixEntry, MatrixViewModel } from "./types";

/**
 * Bases の entries を Bases 非依存の {@link MatrixViewModel} へ変換する純関数。
 *
 * F1（#18）では state（empty/ready）と各 entry の id/title までを組む。
 * 軸値の読み取り（absent 判定）と 4 象限への配置は #19（F2）で本マッパに追加する。
 * `.base` 自身や軸欠損ノートのフィルタも #19 の責務（要件定義書「未決事項」）。
 *
 * `import type` のみで obsidian ランタイムに依存しないため単体テスト可能。
 */
export function toViewModel(entries: readonly BasesEntry[]): MatrixViewModel {
  if (entries.length === 0) {
    return { state: "empty", entries: [] };
  }
  const mapped: MatrixEntry[] = entries.map((entry) => ({
    id: entry.file.path,
    title: entry.file.basename,
  }));
  return { state: "ready", entries: mapped };
}
