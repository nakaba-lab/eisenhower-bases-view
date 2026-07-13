import { useDraggable } from "@dnd-kit/core";
import type { ComponentProps } from "preact";
import { useId } from "preact/hooks";
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
 * **視覚的な装飾（`aria-hidden`）**として描画し、SR にはカードの `aria-describedby`（`buildCardDescription`）
 * が「ラベル＋値」を補足として読み上げる（role=button カードの presentational children では可視テキストが
 * AT ツリーから剥がれ独立到達不可のため、名前を汚さず description 経由で情報パリティを確保する・レビュー指摘）。
 * 期日らしい値（`emphasized`）はアクセント色で強調する（AC4）。
 */
function NoteBadges({ badges }: { badges: NonNullable<MatrixEntry["badges"]> }) {
  // 表示対象（`text !== ""`）の絞り込みは呼び出し側（NoteCard の `visibleBadges`）で一元化し、SR 要約
  //（aria-describedby）と描画で同じ集合を使う（情報パリティ崩れを防ぐ二重実装の解消・レビュー指摘）。
  if (badges.length === 0) return null;
  return (
    <div class="eisenhower-note-card__badges" aria-hidden="true">
      {badges.map((badge, index) => (
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
 * アイコンは装飾（`aria-hidden`）で、状態別 `aria-label`（ノート名＋操作）を SR に届ける。完了状態は
 * `is-completed` クラス（可視）で示し、`aria-pressed` は付けない（APG のトグル指針＝可変ラベルとの併用を避ける）。
 */
function CompletionButton({
  completed,
  unsupported,
  label,
  unsupportedLabel,
  onToggle,
}: {
  completed: boolean;
  unsupported: boolean;
  /** 解決済みの aria-label（ノート名＋操作。NoteCard が entry.title で組む・#105 F10）。 */
  label: string;
  /** 非 boolean 値で無効化されているときの理由（ノート名込み・解決済み）。省略時は状態ラベルのまま。 */
  unsupportedLabel?: string;
  onToggle: (done: boolean) => void;
}) {
  // 無効化時は「押せない理由」を可視（title）・SR（aria-label）双方に出す。さもないと disabled ボタンが
  // 「完了にする, 使用不可」としか読まれず、非 boolean 値の保護という理由が伝わらない（レビュー指摘）。
  const reason = unsupported ? unsupportedLabel : undefined;
  // aria-label は「ノート名＋操作（完了にする/戻す）」で状態を表すため aria-pressed は付けない（APG のトグル
  // 指針＝可変ラベルと aria-pressed の併用を避ける・レビュー指摘）。完了状態は is-completed クラス（可視）で示す。
  return (
    <button
      type="button"
      class={"eisenhower-note-card__complete" + (completed ? " is-completed" : "")}
      aria-label={reason ?? label}
      // title は有効時も操作ラベル（アイコンのみのボタンにマウスホバーのツールチップを出す＝発見性・レビュー指摘）。
      // 無効時は保護理由（reason）を出す。
      title={reason ?? label}
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
   * 期日強調（emphasized＝過期日）バッジの SR 要約に添える注記（i18n `messages.badgeOverdue`・#104）。
   * 視覚の太字＋アクセント色と情報パリティを取る（省略時は日付値のみ＝従来）。
   */
  badgeOverdueLabel?: string;
  /**
   * 完了トグル（#105 F10）が有効か。true のときのみカードにチェックボタンを描画し、`x` キーでトグルする
   *（`MatrixViewModel.completionEnabled` を上流から渡す）。省略/false のときはボタンを出さない（完了プロパティは既定 `done`＝初期有効・空で無効化）。
   */
  completionEnabled?: boolean;
  /**
   * `x` キーで完了トグルできる旨の SR 操作説明（i18n `messages.screenReaderCompletionHint`・#105 F10）。
   * **ロックカード用**: 非ロックは dnd の操作説明経由で案内されるが、ロックカードは dnd 属性を持たないため
   * この案内を SR 要約（aria-describedby）に添える（発見性の非対称の解消・レビュー指摘）。
   */
  completionHint?: string;
  /**
   * チェックボタンの aria-label をノート名＋状態から組む（`completed` → 未完了に戻す／未完了 → 完了にする・#105 F10）。
   * i18n（`completionToggle(title)`/`completionToggleDone(title)`）から組んで渡す。ノート名を含むことで
   * 複数カードで同名ボタンにならず SR で識別できる（レビュー指摘）。ラベルが操作を表すため aria-pressed は付けない。
   */
  completionLabel?: (title: string, completed: boolean) => string;
  /**
   * 非 boolean 値で無効化された完了ボタンの理由ラベルをノート名から組む（i18n `completionUnsupportedLabel(title)`・#105 F10）。
   * 省略時は状態ラベルのまま（disabled 理由を提示しない従来挙動）。
   */
  completionUnsupportedLabel?: (title: string) => string;
  /**
   * 完了状態をトグルする（#105 F10）。UI は目的値 `done` を渡すだけで、書き込みはアダプタが担う（AC5）。
   */
  onToggleCompletion?: (entryId: string, done: boolean) => void;
  /**
   * 非 boolean 完了値で無効化中のカードにトグル操作（`x` キー）が来たときの通知（#105 F10・レビュー指摘）。
   * `MatrixView` が sr-status ライブ領域へ「保護中で変更不可」を読み上げる（silent no-op を避ける）。
   */
  onCompletionUnsupported?: (entryId: string) => void;
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
  badgeOverdueLabel,
  completionEnabled,
  completionHint,
  completionLabel,
  completionUnsupportedLabel,
  onToggleCompletion,
  onCompletionUnsupported,
  dimCompleted,
}: NoteCardProps) {
  // 完了トグル（#105 F10）: 完了状態・非対応（非 boolean）・描画条件を組む。
  const completed = entry.completed ?? false;
  const completionUnsupported = entry.completionUnsupported ?? false;
  // ボタン・x キーを出す条件（有効＋ラベル＋コールバックが揃う）。
  const showCompletion = Boolean(completionEnabled && completionLabel && onToggleCompletion);
  const toggleCompletion = () => {
    if (completionUnsupported) {
      // 非 boolean は破壊しないため無効。ただし x キーの silent no-op を避け、保護中の旨を通知する
      //（disabled ボタンは title/aria-label を持つがキーボード経路には届かないため・レビュー指摘）。
      onCompletionUnsupported?.(entry.id);
      return;
    }
    onToggleCompletion?.(entry.id, !completed);
  };
  const completionButton = showCompletion ? (
    <CompletionButton
      completed={completed}
      unsupported={completionUnsupported}
      // ノート名を含む aria-label をカード側で解決して渡す（どのノートか SR で識別・レビュー指摘）。
      label={completionLabel!(entry.title, completed)}
      unsupportedLabel={completionUnsupportedLabel?.(entry.title)}
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
  // バッジ全体は**視覚装飾（aria-hidden）**とし、経過日数は下記 SR 要約（aria-describedby）で読み上げる
  //（role=button カードの presentational children ではバッジの意味論が剥がれ独立到達不可のため・レビュー指摘）。
  const stagnantDays = stagnantDaysOf(entry);
  // バッジ本文は i18n（stagnantBadge）→ 既定 "Nd"。SR 要約は詳細文言（stagnantLabel）を優先し、
  // 無ければバッジ本文へフォールバックする（SR には少なくとも経過日数が伝わる）。
  const badgeText = stagnantBadge ?? DEFAULT_STAGNANT_BADGE;
  const stagnationBadge =
    stagnantDays !== null ? (
      <span class="eisenhower-note-card__stagnation" aria-hidden="true">
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
  // SR 要約（#104/#106・レビュー指摘）: 視覚バッジ（滞留・追加プロパティ）は aria-hidden の装飾のため、
  // その情報を**カードの補足説明**として 1 つの視覚非表示テキストに集約し、`aria-describedby` で参照する。
  // カード名（aria-label＝title）は汚さず、期日・滞留という意思決定材料を SR/キーボード利用者へも届ける。
  // 表示対象バッジ（値が空でないもの）を一度だけ絞り込み、描画（NoteBadges）と SR 要約で共有する
  //（同じ絞り込みを 2 箇所に持たず情報パリティ崩れを防ぐ・レビュー指摘）。
  const visibleBadges = (entry.badges ?? []).filter((badge) => badge.text !== "");
  // 非 boolean 軸値のカードはドラッグ不可（ドロップの両軸 true/false 上書きで元値破壊を防ぐ・#34 補完）。
  const locked = entry.locked ?? false;
  const descriptionParts: string[] = [];
  if (stagnantDays !== null) descriptionParts.push((stagnantLabel ?? badgeText)(stagnantDays));
  for (const badge of visibleBadges) {
    // emphasized（過期日）は視覚で太字＋アクセント色。SR 要約にも注記を添えて情報パリティを取る（レビュー指摘）。
    const overdue = badge.emphasized && badgeOverdueLabel ? ` ${badgeOverdueLabel}` : "";
    descriptionParts.push(`${badge.label} ${badge.text}${overdue}`);
  }
  // ロックカードは dnd 属性を持たない（＝dnd の操作説明 describedby が付かない）が `x` キーで完了トグルできる
  //（handleLockedKeyDown）。その `x` キー案内（completionHint）を SR 要約に添えて、非ロックカード（dnd の
  // 隠しテキスト経由で案内される）との発見性の非対称を解消する（レビュー指摘）。非ロックは dnd 側で案内済み。
  if (locked && showCompletion && completionHint) descriptionParts.push(completionHint);
  const cardDescription = descriptionParts.join(", ");
  const descriptionId = useId();
  const describedBy = cardDescription !== "" ? descriptionId : undefined;
  const cardDescriptionNode =
    cardDescription !== "" ? (
      <span id={descriptionId} class="eisenhower-sr-only">
        {cardDescription}
      </span>
    ) : null;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
    disabled: locked,
  });
  const className =
    "eisenhower-note-card" +
    (isDragging ? " eisenhower-note-card--dragging" : "") +
    // 完了ボタンはカード div の**兄弟**として絶対配置する（nested-interactive 回避・下記 return）。
    // タイトル行が絶対配置ボタンの下に潜らないよう、表示時はカードに余白予約クラスを付ける。
    (showCompletion ? " eisenhower-note-card--with-completion" : "") +
    completionClass;
  // dnd-kit の attributes（role:string）/listeners は React 型のため、
  // Preact の div 属性型へ寄せて展開する（role/tabindex/aria-* とキーボード操作を付与＝AC5）。
  const dndAttributes = attributes as unknown as DivProps;
  const dndListeners = (listeners ?? {}) as unknown as DivProps;
  // **dnd-kit は `aria-describedby` を設定する**（キーボード DnD の操作説明＝`screenReaderInstructions.draggable`
  // ＋ #105 の `x` キー完了案内を指す隠しテキスト id）。自前のバッジ/滞留要約 id で**上書きすると**その操作説明が
  // SR から消える（バッジ無しカードでは undefined で属性ごと消滅＝キーボード操作が発見不能になる回帰）。
  // よって上書きではなく**両 id をスペース区切りで連結**する（`aria-describedby` は複数 id を許容・レビュー指摘 must）。
  const dndDescribedBy = dndAttributes["aria-describedby"];
  const describedByParts = [dndDescribedBy, describedBy].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  const mergedDescribedBy = describedByParts.length > 0 ? describedByParts.join(" ") : undefined;
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

  // カード div の**内側**（タイトル行＋滞留バッジ＋追加プロパティバッジ＋SR 要約）を 1 箇所に集約し、
  // ロック/非ロックの 2 分岐で重複させない（片側だけ変えると表示・情報パリティが乖離する回帰を防ぐ・レビュー指摘）。
  // 差分はタイトル span 内のロックアイコンのみ（`locked` フラグで分岐）。完了ボタンはカード div の兄弟のため含めない。
  const cardBody = (
    <>
      <div class="eisenhower-note-card__title-row">
        <span class="eisenhower-note-card__title">
          {locked && (
            <span class="eisenhower-note-card__lock" aria-hidden="true">
              🔒
            </span>
          )}
          {entry.title}
        </span>
        {stagnationBadge}
      </div>
      <NoteBadges badges={visibleBadges} />
      {cardDescriptionNode}
    </>
  );

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
          aria-describedby={describedBy}
          onClick={handleClick}
          onKeyDown={handleLockedKeyDown}
          onMouseEnter={handleMouseEnter}
        >
          {cardBody}
        </div>
        {/* 完了ボタンはカード（role=button）の子ではなく兄弟に置き nested-interactive を避ける（レビュー指摘）。 */}
        {completionButton}
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
        // role="button" の非ロックカードのアクセシブル名を **title だけ**に固定する（レビュー指摘）。
        // 明示 aria-label が無いと accname の name-from-content で子（滞留バッジ・追加プロパティバッジ）が
        // 名前に流れ込み冗長化する（ロックカードは既に aria-label を持ち非対称だった）。バッジ/滞留の情報は
        // aria-describedby で補足として届ける。**dndAttributes は aria-label は含まないが aria-describedby は
        // 含む**（DnD 操作説明を指す）ため、上書きせず `mergedDescribedBy`（dnd の id＋自前の要約 id を連結）
        // を渡す（spread の後に置いて後勝ちさせる＝レビュー指摘 must の回帰対策）。
        aria-label={entry.title}
        aria-describedby={mergedDescribedBy}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
      >
        {cardBody}
      </div>
      {/* 完了ボタンはドラッグ可能な role=button カードの子ではなく兄弟に置き、nested-interactive
          （相互作用要素の入れ子）を避ける。視覚的にはカード右上へ絶対配置する（styles.css）。 */}
      {completionButton}
    </li>
  );
}
