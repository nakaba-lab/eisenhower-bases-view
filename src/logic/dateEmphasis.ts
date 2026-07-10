/**
 * dateEmphasis — 「厳格 ISO 日付（YYYY-MM-DD）が今日以前か」を判定する純ロジック（#104 F8・AC4）。
 *
 * カード追加プロパティ表示（バッジ）の日付強調トグルが on のとき、期日らしい値を強調するかを決める。
 * `today` は ISO 文字列で注入する（`Date.now()` 非依存＝単体テスト可能）。**厳格 ISO 判定に限定**し、
 * Bases の filter/formula の再実装には踏み込まない（将来これを条件付き書式 DSL に育てない＝設計の線引き）。
 */

/** `YYYY-MM-DD`（ゼロ埋め・区切りハイフンのみ）に完全一致するか。 */
const STRICT_ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `text` が厳格 ISO 文字列（`YYYY-MM-DD`）で、かつ実在する暦日なら true（不正は false）。
 * `new Date(y, m-1, d)` の各フィールドが入力と一致することで、13 月・2 月 30 日などの繰り上げを弾く。
 */
function isStrictIsoDate(text: string): boolean {
  const match = STRICT_ISO_DATE.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // UTC で構築して各フィールドの一致を見る（暦として実在する日だけ通す。繰り上げ＝不正）。
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * `text` が厳格 ISO 日付（実在する `YYYY-MM-DD`）で、かつ `today`（同形式）**以前**なら true（AC4）。
 * 「今日以前」は today ちょうどを含む。text/today のどちらかが厳格 ISO でなければ false（安全側で強調しない）。
 * 厳格 ISO 同士の辞書順比較は暦順と一致するため、Date 演算に頼らず文字列比較で判定する。
 */
export function isEmphasizedDate(text: string, today: string): boolean {
  if (!isStrictIsoDate(text) || !isStrictIsoDate(today)) return false;
  return text <= today;
}
