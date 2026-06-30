import { render as preactRender } from "preact";
import type { MatrixCallbacks, MatrixViewModel } from "../bases/types";
import { QuadrantCell } from "./QuadrantCell";

/**
 * Matrix ビューの命令的な描画入口（アダプタ層が onDataUpdated 内で呼ぶ＝AC3）。
 *
 * #19（F2）: 2×2 グリッド（Do/Schedule/Delegate/Delete）＋下部フル幅の未分類ゾーンを
 * `placements` から描画する（事前グルーピング済みのため UI は配置のみ）。
 * 配色はハードコードせず Obsidian テーマ変数（styles.css）に追従する。
 */

// ユーザー向け文言。i18n（#23 F6）導入時はここを起点に翻訳テーブルへ差し替える。
const MATRIX_LABEL = "Eisenhower Matrix";
const LOADING_TEXT = "読み込み中…";
const EMPTY_TEXT = "表示するノートがありません";
const EMPTY_QUADRANT_TEXT = "なし";

/** 2×2 グリッドの象限定義（ワイヤーフレーム順: 上段 Do/Schedule、下段 Delegate/Delete）。 */
const QUADRANTS = [
  { key: "do", label: "Do", axisLabel: "重要 × 緊急" },
  { key: "schedule", label: "Schedule", axisLabel: "重要 × 非緊急" },
  { key: "delegate", label: "Delegate", axisLabel: "非重要 × 緊急" },
  { key: "delete", label: "Delete", axisLabel: "非重要 × 非緊急" },
] as const;

const UNCLASSIFIED_LABEL = "未分類";
const UNCLASSIFIED_AXIS_LABEL = "軸欠損・ドロップ不可";

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

  const { placements } = viewModel;
  return (
    <section class="eisenhower-matrix" role="group" aria-label={MATRIX_LABEL}>
      <div class="eisenhower-matrix__grid">
        {QUADRANTS.map((quadrant) => (
          <QuadrantCell
            key={quadrant.key}
            label={quadrant.label}
            axisLabel={quadrant.axisLabel}
            entries={placements[quadrant.key]}
            emptyText={EMPTY_QUADRANT_TEXT}
          />
        ))}
      </div>
      <QuadrantCell
        label={UNCLASSIFIED_LABEL}
        axisLabel={UNCLASSIFIED_AXIS_LABEL}
        entries={placements.unclassified}
        emptyText={EMPTY_QUADRANT_TEXT}
        variant="unclassified"
      />
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
