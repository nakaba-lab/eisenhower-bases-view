import { render as preactRender } from "preact";
import type { MatrixCallbacks, MatrixViewModel } from "../bases/types";

/**
 * Matrix ビューの命令的な描画入口（アダプタ層が onDataUpdated 内で呼ぶ＝AC3）。
 *
 * F1（#18）の範囲はシェル＋状態表示（loading / empty / ready）。2×2 グリッドの
 * 実レイアウトとカード配置は #19（F2）が `ui.md` のワイヤーフレームに沿って充填する。
 * 配色はハードコードせず Obsidian テーマ変数（styles.css）に追従する。
 */

// ユーザー向け文言。i18n（#23 F6）導入時はここを起点に翻訳テーブルへ差し替える。
const MATRIX_LABEL = "Eisenhower Matrix";
const LOADING_TEXT = "読み込み中…";
const EMPTY_TEXT = "表示するノートがありません";

interface MatrixViewProps {
  viewModel: MatrixViewModel;
  callbacks: MatrixCallbacks;
}

function MatrixView({ viewModel }: MatrixViewProps) {
  if (viewModel.state === "loading") {
    return (
      <div
        class="eisenhower-matrix eisenhower-matrix--loading"
        role="status"
        aria-live="polite"
      >
        {LOADING_TEXT}
      </div>
    );
  }

  if (viewModel.state === "empty") {
    return (
      <section
        class="eisenhower-matrix eisenhower-matrix--empty"
        role="group"
        aria-label={MATRIX_LABEL}
      >
        <p class="eisenhower-matrix__placeholder">{EMPTY_TEXT}</p>
      </section>
    );
  }

  return (
    <section
      class="eisenhower-matrix"
      role="group"
      aria-label={MATRIX_LABEL}
    >
      {/* F1: マトリクス領域の枠のみ。4 象限グリッドとカードは #19 で充填する。 */}
      <div class="eisenhower-matrix__grid" aria-hidden="true" />
    </section>
  );
}

/**
 * ViewModel を `containerEl` に Preact 描画する（再呼び出しで差分更新）。
 */
export function render(
  container: HTMLElement,
  viewModel: MatrixViewModel,
  callbacks: MatrixCallbacks = {},
): void {
  preactRender(<MatrixView viewModel={viewModel} callbacks={callbacks} />, container);
}

/**
 * Preact ルートを破棄してコンテナを空にする（リーク防止＝AC4）。
 */
export function unmount(container: HTMLElement): void {
  preactRender(null, container);
}
