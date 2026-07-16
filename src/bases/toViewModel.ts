import type { BasesEntry, BasesViewConfig } from "obsidian";
import { DEFAULT_SETTINGS, type EisenhowerSettings } from "../settings";
import { classifyQuadrant } from "../logic/quadrant";
import { messagesFor, type Messages } from "../i18n";
import {
  axesShareWritableKey,
  readAxisReadings,
  readCompletionState,
  resolveAxisPropertyIds,
  resolveCompletionId,
  toFrontmatterKey,
  type AxisPropertyIds,
} from "./readAxis";
import { readBadges, resolveBadgePropertyIds } from "./readBadges";
import { resolvePresentation } from "./presentation";
import { resolveStagnationThresholdDays } from "./stagnationThreshold";
import { resolveNumberThresholds } from "./numberThreshold";
import { resolveTagNames, type TagNames } from "./tagAxis";
import { evaluateStagnation } from "../logic/stagnation";
import type { AxisSpec } from "../logic/axis";
import type {
  MatrixDiagnostics,
  MatrixEntry,
  MatrixViewModel,
  QuadrantPlacements,
} from "./types";

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
 * 解決済み軸 propertyId から診断情報を組む（#103 F7）。既存の `axesShareWritableKey`／
 * `toFrontmatterKey` の結果を転送するだけ（Bases API への新規接触なし）。軸名は書き戻しキー
 *（利用者が設定タブ・Bases options で編集する表記）で持ち、非 `note.*`（`formula.*`／`file.*`＝
 * `toFrontmatterKey` が `null`）は生の propertyId をフォールバック表示する（"null" を出さない）。
 */
/**
 * tagNames から `axesShareWritableKey` 用の per-axis {@link AxisSpec} を導く（#125）。tag 軸は
 * `{kind:"tag", tag}`・非タグ軸は `{kind:"boolean"}`（数値/選択の別 kind は同一キー衝突の可否に影響しない＝
 * tag∧tag∧異 tagName のみ合法で他は衝突のため boolean 既定で十分）。これで tag×tag×異 tagName の同一キーが
 * 「設定ミス」判定に落ちず、全カードロックを回避する（読み取り側と書き込み側 `resolveWritableAxisKeys` を同期）。
 */
function tagAwareSpecs(tagNames: TagNames): { urgent: AxisSpec; important: AxisSpec } {
  const specFor = (tag: string | null): AxisSpec =>
    tag !== null ? { kind: "tag", tag } : { kind: "boolean" };
  return { urgent: specFor(tagNames.urgent), important: specFor(tagNames.important) };
}

function buildDiagnostics(
  ids: AxisPropertyIds,
  specs: { urgent: AxisSpec; important: AxisSpec },
): MatrixDiagnostics {
  const shared = axesShareWritableKey(ids, specs);
  const urgentAxis = toFrontmatterKey(ids.urgent) ?? String(ids.urgent);
  const importantAxis = toFrontmatterKey(ids.important) ?? String(ids.important);
  const diagnostics: MatrixDiagnostics = {
    axesShareWritableKey: shared,
    urgentAxis,
    importantAxis,
  };
  // shared のときは両軸が同一 frontmatter キーで、その値は解決済みの urgentAxis に等しい
  //（axesShareWritableKey が非 null を保証）。共有キーを載せる（UI の警告バナーが名指しする）。
  if (shared) diagnostics.sharedAxisKey = urgentAxis;
  return diagnostics;
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
  // 滞留判定の「今日」（epoch ms）。テストは固定値を注入、実機はデフォルト `Date.now()`（#106 F9）。
  // 再計算は toViewModel 実行時のみ（開きっぱなしで日付境界を跨いでも次の再描画まで更新されない
  // ＝日単位粒度の割り切り。設計は docs/design/bases.md「滞留インジケータ」節）。
  now: number = Date.now(),
  // 今日の日付（ISO YYYY-MM-DD）。バッジの日付強調（#104 F8・AC4）に使う。アダプタが注入する
  // （Date.now() 非依存で純度維持）。省略時は空＝日付強調しない（安全側）。
  today: string = "",
): MatrixViewModel {
  // ラベル/色/言語文言を解決して UI へ渡す（#23 F6）。状態に依らず常に載せる。
  const presentation = resolvePresentation(settings, messages);

  // クエリ未初期化・失敗で data が undefined/null になっても落ちないよう防御する。
  // 非 Markdown（.base 自身・.canvas・画像等）は配置対象外のため事前に除外する（要件 §9）。
  const notes = entries ? entries.filter(isPlaceableNote) : [];
  // 軸解決と診断は notes 有無に依らず行う（空状態でも軸名・設定ミスを提示する＝#103 F7）。
  const ids = resolveAxisPropertyIds(config, settings);
  // タグ軸（#125）: per-axis tagName を 1 度解決する（ビュー options 主・設定既定＝ハイブリッド）。
  // null＝当該軸はタグ軸オフ。診断（同一キー kind-aware 判定）と読み取りの両方で共有する。
  const tagNames = resolveTagNames(config, settings);
  const diagnostics = buildDiagnostics(ids, tagAwareSpecs(tagNames));
  // カード上の完了トグル（#105 F10）: 完了プロパティを解決する（既定 done で有効・非 note.*/軸衝突/明示空は null＝無効）。
  // 有効なら UI がチェックボタンを描画する（completionEnabled）。null のときは機能オフ。
  // 解決済み ids を渡して 3 キー衝突ガードの軸再解決（1 レンダーでの二重解決）を避ける（レビュー指摘）。
  const completionId = resolveCompletionId(config, settings, ids);
  const completionEnabled = completionId !== null;
  if (notes.length === 0) {
    return {
      state: "empty",
      entries: [],
      placements: emptyPlacements(),
      showUnclassified: settings.showUnclassified,
      presentation,
      diagnostics,
      completionEnabled,
      dimCompleted: settings.dimCompleted,
    };
  }

  // 両軸が同一 note.* キー（設定ミス）だと書き戻しが必ず失敗するため、当該ビューの全カードを
  // ドラッグ不可にして「掴めるのに必ず失敗する」状態を作らない（書込前ガードと対称・レビュー指摘）。
  const sameAxisKey = diagnostics.axesShareWritableKey;
  // カード追加プロパティ表示（#104 F8）: 表示するバッジプロパティを解決する（既定 0 個＝現状維持）。
  const badgeIds = resolveBadgePropertyIds(config, settings);
  // 滞留しきい値を解決する（ビュー options 主・設定既定フォールバック＝ハイブリッド・#106 F9）。
  // 全カードで共通のため map の外で 1 度だけ解決する（0 は機能オフ）。
  const stagnationThresholdDays = resolveStagnationThresholdDays(config, settings);
  // 数値しきい値軸（#121 v0.3-1a）: per-axis しきい値を 1 度解決する（ビュー options 主・設定既定＝ハイブリッド）。
  // 全カードで共通のため map の外で 1 度だけ（null＝当該軸の数値軸オフ＝v1 挙動）。
  const numberThresholds = resolveNumberThresholds(config, settings);
  const placements = emptyPlacements();
  const mapped: MatrixEntry[] = notes.map((entry) => {
    // 両軸を 1 経路で読み、配置側（side）とロック（locked）を同時に得る（#121・タグ軸は #125）。
    const readings = readAxisReadings(entry, ids, numberThresholds, tagNames);
    const axis = { urgent: readings.urgent.side, important: readings.important.side };
    const quadrant = classifyQuadrant(axis);
    const matrixEntry: MatrixEntry = {
      id: entry.file.path,
      title: entry.file.basename,
      urgent: axis.urgent,
      important: axis.important,
    };
    // ドラッグ不可条件（UI が印を付ける）: 両軸同一キー設定、または軸の読み取りが locked
    //（書込可能 note.* の非 boolean 値・未対応 Value 型・数値軸カード＝1a は書き戻し未実装で常に locked）。
    if (sameAxisKey || readings.urgent.locked || readings.important.locked) {
      matrixEntry.locked = true;
    }
    // 滞留判定（#106 F9・読み取り専用）: mtime が読め、しきい値超過なら滞留フラグと経過日数を載せる。
    // 非滞留・mtime 欠落は付けない（`locked?` と同じ optional 流儀）。
    const mtime = readMtime(entry);
    if (mtime !== undefined) {
      const stagnation = evaluateStagnation(mtime, now, stagnationThresholdDays);
      if (stagnation.stagnant) {
        matrixEntry.stagnant = true;
        matrixEntry.stagnantDays = stagnation.days;
      }
    }
    // バッジは表示プロパティが 1 つ以上あるときだけ載せる（0 個は undefined＝現状維持・#104 F8・AC3）。
    if (badgeIds.length > 0) {
      matrixEntry.badges = readBadges(entry, badgeIds, {
        today,
        emphasizePastDates: settings.emphasizePastDates,
      });
    }
    // 完了状態（#105 F10）: 完了プロパティ有効時のみ、done:true は completed・非 boolean は
    // completionUnsupported（トグル無効＝元値破壊防止・AC2）を載せる（`locked?` と同じ optional 流儀）。
    if (completionId !== null) {
      const completion = readCompletionState(entry, completionId);
      if (completion.completed) matrixEntry.completed = true;
      if (completion.unsupported) matrixEntry.completionUnsupported = true;
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
    diagnostics,
    completionEnabled,
    dimCompleted: settings.dimCompleted,
  };
}
