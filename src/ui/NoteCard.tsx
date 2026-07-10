import { useDraggable } from "@dnd-kit/core";
import type { ComponentProps } from "preact";
import type { MatrixEntry } from "../bases/types";
import { isOpenKey, openLeafIntent } from "./cardInteraction";

// preact の非推奨 `JSX.HTMLAttributes`/`JSX.Targeted*Event` を避け、非推奨でない
// `ComponentProps` から div の props とイベント型を導出する（直接名指ししないため非推奨警告が出ない）。
type DivProps = ComponentProps<"div">;
type DivMouseEvent = Parameters<NonNullable<DivProps["onClick"]>>[0];
type DivKeyboardEvent = Parameters<NonNullable<DivProps["onKeyDown"]>>[0];

/** カードフォーカス中に完了トグルを起動するキー（`x`/`X`＝CapsLock/Shift の大文字も受け大小無反応の silent no-op を避ける・#105 F10）。 */
function isCompletionToggleKey(event: DivKeyboardEvent): boolean {
  return event.key === "x" || event.key === "X";
}

/**
 * 1 ノートのカード。dnd-kit の `useDraggable` でドラッグ可能にする（#20 F3）。
 *
 * `attributes`（`role="button"`/`tabIndex`/`aria-*`）と `listeners` は**内側の要素**に展開する。
 * dnd-kit が付ける `role="button"` を外側の `<li>` に乗せると `<ul>` のリスト意味論
 *（件数・項目位置）が失われるため、`<li>` は listitem のまま保ち、ドラッグ可能要素を内側に置く
 *（レビュー指摘 #9）。マウスだけでなく**キーボードでも掴んで移動**できる（AC5）。
 *
 * #22（F5）で**開く/プレビュー**導線を追加: 素のクリック/Enter で現在のリーフ、Cmd・Ctrl+ で新タブ
 *（`onOpenCard`）。ホバーで core page-preview（`onHoverCard`）。掴む（ドラッグ）は Space に整理し
 * Enter を「開く」に解放する（`MatrixView` で `KeyboardSensor` の起動キーを Space のみに remap）。
 * native `title` は撤去し、ホバーはコアプレビューへ一本化する。開く/preview の実処理はアダプタへ委譲（AC5）。
 */
/**
 * カード追加プロパティの読み取り専用バッジ（#104 F8）。タイトルの下に控えめに並べる。
 * 表示 0 個（`badges` が空/未定義）なら何も描画しない（カード密度は現状維持＝AC3）。
 * ラベルと値を可視テキストとして描画し、SR にはラベル＋値が読み上げられる（人間承認済み）。
 * 期日らしい値（`emphasized`）はアクセント色で強調する（AC4）。
 */
function NoteBadges({ badges }: { badges: MatrixEntry["badges"] }) {
  // 値が空（absent／例外で退避＝AC2）のバッジはラベルだけの“壊れて見える”チップになるため描画しない
  //（データ側は件数を保つ＝AC1・UI 側で空を省く＝frontend-reviewer should）。
  const visible = badges?.filter((badge) => badge.text !== "");
  if (!visible || visible.length === 0) return null;
  return (
    <div class="eisenhower-note-card__badges">
      {visible.map((badge, index) => (
        <span
          key={index}
          class={
            "eisenhower-note-card__badge" +
            (badge.emphasized ? " eisenhower-note-card__badge--emphasized" : "")
          }
        >
          <span class="eisenhower-note-card__badge-label">{badge.label}</span>
          <span class="eisenhower-note-card__badge-text">{badge.text}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * カード上の完了チェックボタン（#105 F10）。タイトル行の右端に置き、hover/focus で出現する
 *（完了時は常時可視・CSS）。クリック（またはカードフォーカス中の `x` キー）で完了をトグルする。
 * click-to-open と `PointerSensor(distance:5)` に対し `stopPropagation` して開く/掴むと衝突させない
 *（AC5）。非 boolean 完了値（`unsupported`）は `disabled` で押下を塞ぎ元値を守る（AC2）。
 * アイコンは装飾（`aria-hidden`）で、状態別 `aria-label` と `aria-pressed` を SR に届ける。
 */
function CompletionButton({
  completed,
  unsupported,
  label,
  onToggle,
}: {
  completed: boolean;
  unsupported: boolean;
  label: (completed: boolean) => string;
  onToggle: (done: boolean) => void;
}) {
  return (
    <button
      type="button"
      class={"eisenhower-note-card__complete" + (completed ? " is-completed" : "")}
      aria-label={label(completed)}
      aria-pressed={completed}
      disabled={unsupported}
      onClick={(event) => {
        // 開く導線（カードの onClick）へ伝播させない（AC5）。目的値は現状態の反転（双方向トグル）。
        event.stopPropagation();
        // disabled でも念のためガード（非 boolean は元値を破壊しない・AC2）。
        if (unsupported) return;
        onToggle(!completed);
      }}
      // ドラッグ開始（PointerSensor distance:5）とカードのキー操作（開く/掴む）に伝播させない。
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <svg
        class="eisenhower-note-card__complete-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path
          class="eisenhower-note-card__complete-check"
          d="M5 8.25 L7 10.25 L11 6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  );
}

export interface NoteCardProps {
  entry: MatrixEntry;
  /** クリック/Enter で開く（#22 F5）。UI は修飾キーから `newLeaf` を算出して渡す。 */
  onOpenCard?: (entryId: string, opts: { newLeaf: boolean }) => void;
  /** ホバーでページプレビュー（#22 F5）。`targetEl` はプレビュー位置決めのカード要素。 */
  onHoverCard?: (entryId: string, targetEl: HTMLElement, event: MouseEvent) => void;
  /**
   * ロックされたカード（`entry.locked`＝非 boolean 軸値でドラッグ不可）のアクセシブル名を組む
   *（i18n の `messages.cardLockedLabel`）。省略時は `entry.title` のみ。
   */
  lockedLabel?: (title: string) => string;
  /**
   * 滞留バッジ本文を経過日数から組む（i18n `messages.stagnantBadge`・例 "21d"/"21日"・#106）。
   * 省略時は `${days}d` にフォールバック。
   */
  stagnantBadge?: (days: number) => string;
  /**
   * 滞留バッジの aria-label を経過日数から組む（i18n `messages.stagnantLabel`・SR 読み上げ・#106）。
   * 省略時はバッジ本文にフォールバックする（SR で経過日数だけは伝わる）。
   */
  stagnantLabel?: (days: number) => string;
  /**
   * 完了トグル（#105 F10）が有効か。true のときのみカードにチェックボタンを描画し、`x` キーでトグルする
   *（`MatrixViewModel.completionEnabled` を上流から渡す）。省略/false のときはボタンを出さない（opt-in）。
   */
  completionEnabled?: boolean;
  /**
   * チェックボタンの状態別 aria-label（`completed` → 未完了に戻す／未完了 → 完了にする・#105 F10）。
   * i18n（`completionToggle`/`completionToggleDone`）から組んで渡す。
   */
  completionLabel?: (completed: boolean) => string;
  /**
   * 完了状態をトグルする（#105 F10）。UI は目的値 `done` を渡すだけで、書き込みはアダプタが担う（AC5）。
   */
  onToggleCompletion?: (entryId: string, done: boolean) => void;
  /**
   * 完了ノートを淡色表示するか（設定 `dimCompleted` の反映・#105 F10）。true かつ完了時に
   * `--dimmed`（弱色トークンで色を落とす。`opacity` ではない）を付ける。
   */
  dimCompleted?: boolean;
}

/** 滞留バッジの経過日数（present なら number、それ以外は null）。`stagnant` かつ日数が数値のときだけ描画する。 */
function stagnantDaysOf(entry: MatrixEntry): number | null {
  return entry.stagnant === true && typeof entry.stagnantDays === "number"
    ? entry.stagnantDays
    : null;
}

/** 滞留バッジ本文の既定フォールバック（i18n `stagnantBadge` 未配線時・例 "21d"・#106）。 */
const DEFAULT_STAGNANT_BADGE = (days: number): string => `${days}d`;

export function NoteCard({
  entry,
  onOpenCard,
  onHoverCard,
  lockedLabel,
  stagnantBadge,
  stagnantLabel,
  completionEnabled,
  completionLabel,
  onToggleCompletion,
  dimCompleted,
}: NoteCardProps) {
  // 完了トグル（#105 F10）: 完了状態・非対応（非 boolean）・描画条件を組む。
  const completed = entry.completed ?? false;
  const completionUnsupported = entry.completionUnsupported ?? false;
  // ボタン・x キーを出す条件（有効＋ラベル＋コールバックが揃う）。
  const showCompletion = Boolean(completionEnabled && completionLabel && onToggleCompletion);
  const toggleCompletion = () => {
    if (completionUnsupported) return; // 非 boolean は破壊しないため無効
    onToggleCompletion?.(entry.id, !completed);
  };
  const completionButton = showCompletion ? (
    <CompletionButton
      completed={completed}
      unsupported={completionUnsupported}
      label={completionLabel!}
      onToggle={(done) => onToggleCompletion!(entry.id, done)}
    />
  ) : null;
  // 完了カードは --completed（CSS が ☑ を常時可視にする）、淡色オプション on なら --dimmed（弱色トークン）。
  // 両クラスの共通条件（完了かつボタン表示中）を一度で組む。
  const completedVisible = completed && showCompletion;
  const completionClass =
    (completedVisible ? " eisenhower-note-card--completed" : "") +
    (completedVisible && dimCompleted ? " eisenhower-note-card--dimmed" : "");
  // 滞留バッジ（#106）: 滞留カードにのみ時計＋経過日数を控えめ（--text-muted）に付ける。
  // 時計は装飾（aria-hidden）で、バッジ全体に aria-label を付けて経過日数を SR に読み上げる。
  const stagnantDays = stagnantDaysOf(entry);
  // バッジ本文は i18n（stagnantBadge）→ 既定 "Nd"。aria-label は詳細文言（stagnantLabel）を優先し、
  // 無ければバッジ本文へフォールバックする（SR には少なくとも経過日数が伝わる）。
  const badgeText = stagnantBadge ?? DEFAULT_STAGNANT_BADGE;
  const stagnationBadge =
    stagnantDays !== null ? (
      <span
        class="eisenhower-note-card__stagnation"
        role="img"
        aria-label={(stagnantLabel ?? badgeText)(stagnantDays)}
      >
        <svg
          class="eisenhower-note-card__stagnation-icon"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path
            d="M8 4.5 V8 L10.5 9.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        {badgeText(stagnantDays)}
      </span>
    ) : null;
  // 非 boolean 軸値のカードはドラッグ不可（ドロップの両軸 true/false 上書きで元値破壊を防ぐ・#34 補完）。
  const locked = entry.locked ?? false;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
    disabled: locked,
  });
  const className =
    "eisenhower-note-card" +
    (isDragging ? " eisenhower-note-card--dragging" : "") +
    completionClass;
  // dnd-kit の attributes（role:string）/listeners は React 型のため、
  // Preact の div 属性型へ寄せて展開する（role/tabindex/aria-* とキーボード操作を付与＝AC5）。
  const dndAttributes = attributes as unknown as DivProps;
  const dndListeners = (listeners ?? {}) as unknown as DivProps;
  // KeyboardSensor の掴み（ドラッグ開始）listener。Enter 以外（Space 等）はこれへ委譲する。
  const dndKeyDown = dndListeners.onKeyDown;

  // クリックで開く（素=現在のリーフ／Cmd・Ctrl+=新タブ＝AC1/AC2）。
  const handleClick = (event: DivMouseEvent) => {
    onOpenCard?.(entry.id, openLeafIntent(event));
  };
  // Enter で開く（AC4）。ただし**キーボードでドラッグ中**（Space で掴んだ最中）の Enter は開かず、
  // dnd-kit へ委譲する（掴んだまま別リーフが開いてドラッグが宙ぶらりんになるのを防ぐ＝レビュー指摘。
  // ドロップは Space/Tab、キャンセルは Esc）。それ以外のキー（Space=掴む 等）も dnd-kit へ委譲する。
  const handleKeyDown = (event: DivKeyboardEvent) => {
    if (isOpenKey(event) && !isDragging) {
      event.preventDefault();
      onOpenCard?.(entry.id, openLeafIntent(event));
      return;
    }
    // x キーで完了トグル（#105 F10）。Space=掴む/Enter=開く と非衝突（掴み中は発火しない）。
    if (isCompletionToggleKey(event) && showCompletion && !isDragging) {
      event.preventDefault();
      toggleCompletion();
      return;
    }
    dndKeyDown?.(event);
  };
  // ロックカードのキーボード操作: 掴めない（Space の掴み予約が無い）ため、Enter に加え **Space でも開く**。
  // role=button の標準操作（Enter/Space で活性化）に揃え、preventDefault で Space によるペインのスクロールを
  // 防ぐ（Space が無反応かつスクロールする壊れた挙動の是正・レビュー指摘）。
  const handleLockedKeyDown = (event: DivKeyboardEvent) => {
    // x キーで完了トグル（軸ロックでも完了プロパティが有効なら切り替えられる・#105 F10）。
    if (isCompletionToggleKey(event) && showCompletion) {
      event.preventDefault();
      toggleCompletion();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenCard?.(entry.id, openLeafIntent(event));
    }
  };
  // ホバーで core page-preview を起動（AC3）。表示可否はユーザーのコア設定に委ねる。
  const handleMouseEnter = (event: DivMouseEvent) => {
    onHoverCard?.(entry.id, event.currentTarget, event);
  };

  if (locked) {
    // ロックカード: dnd 属性/listener を付けずドラッグ不可にする（掴めない＝誤ドロップでのデータ破壊を防ぐ）。
    // 開く（クリック/Enter）とホバープレビューは残す（ユーザーがノートを開いて非 boolean 値を直せる）。
    // 視覚は --locked（淡色・鍵アイコン）でマークし、アクセシブル名に移動不可の理由を含める。
    return (
      <li class="eisenhower-note-card-item">
        <div
          class={`${className} eisenhower-note-card--locked`}
          role="button"
          tabIndex={0}
          aria-label={lockedLabel ? lockedLabel(entry.title) : entry.title}
          onClick={handleClick}
          onKeyDown={handleLockedKeyDown}
          onMouseEnter={handleMouseEnter}
        >
          <div class="eisenhower-note-card__title-row">
            <span class="eisenhower-note-card__title">
              <span class="eisenhower-note-card__lock" aria-hidden="true">
                🔒
              </span>
              {entry.title}
            </span>
            {stagnationBadge}
            {completionButton}
          </div>
          <NoteBadges badges={entry.badges} />
        </div>
      </li>
    );
  }

  return (
    <li class="eisenhower-note-card-item">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions --
          dnd-kit の attributes が role="button"/tabIndex/aria-* を、listeners がキーボード/ポインタ操作を
          実行時に付与する（spread のため静的解析には見えない）。role・タブ・マウス・キーボード・タッチは
          いずれも満たしており（onClick/onKeyDown/onMouseEnter＋touch-action）、開く導線を足した false positive。 */}
      <div
        ref={setNodeRef}
        class={className}
        {...dndAttributes}
        {...dndListeners}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
      >
        <div class="eisenhower-note-card__title-row">
          <span class="eisenhower-note-card__title">{entry.title}</span>
          {stagnationBadge}
          {completionButton}
        </div>
        <NoteBadges badges={entry.badges} />
      </div>
    </li>
  );
}
