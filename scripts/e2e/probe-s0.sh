#!/usr/bin/env bash
# S0 スパイク（v0.3 軸の一般化）throwaway ハーネス。setup-and-run.sh を土台に、数値/文字列/タグの
# フィクスチャを持つ Vault で Obsidian を CDP 起動し probe-s0.js（Value 表現の introspect）を回す。
# 詳細は docs/superpowers/specs/2026-07-11-axis-generalization-v0.3-design.md §4。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

OBS_VERSION="${OBS_VERSION:-1.12.7}"
PLUGIN_MAIN="${PLUGIN_MAIN:-$REPO_ROOT/main.js}"
VIEW_TYPE="${VIEW_TYPE:-eisenhower-matrix}"
CDP_PORT="${CDP_PORT:-9222}"
# WORK は固定（Obsidian 展開の再利用）。scratchpad 配下。--keep で再実行時にダウンロードを使い回す。
WORK="${WORK:-/tmp/claude-1000/-home-user-work-obsidian-eisenhower-matrix/a44543fc-2b8a-4217-8824-405527ff5326/scratchpad/obs-s0-spike}"

OUT="$WORK/out"; OBSDIR="$WORK/obs"; VAULT="$WORK/vault"; HOMEDIR="$WORK/home"
PLUGDIR="$VAULT/.obsidian/plugins/eisenhower-bases-view"
rm -rf "$VAULT" "$HOMEDIR"   # Vault と home は毎回作り直す（Obsidian バイナリ $OBSDIR は残す）
mkdir -p "$OUT" "$OBSDIR" "$PLUGDIR" "$HOMEDIR/.config/obsidian"

echo "[s0] WORK=$WORK  OBS=$OBS_VERSION  VIEW_TYPE=$VIEW_TYPE"

if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  echo "[s0] ERROR: GUI ディスプレイがありません（DISPLAY / WAYLAND_DISPLAY 未設定）。"
  exit 1
fi
if curl -s --max-time 2 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; then
  echo "[s0] ERROR: CDP ポート $CDP_PORT は使用中（別/残存 Obsidian の可能性）。誤接続防止のため中止。"
  echo "[s0]        CDP_PORT=9333 scripts/e2e/probe-s0.sh のように別ポートで再実行してください。"
  exit 1
fi
[ -f "$PLUGIN_MAIN" ] || { echo "[s0] ERROR: $PLUGIN_MAIN なし。先に 'npm run build'。"; exit 1; }
PLUGIN_DIR_SRC="$(dirname "$PLUGIN_MAIN")"

# 1) Obsidian 取得（未取得時のみ）
OBS_BIN="$OBSDIR/obsidian-$OBS_VERSION/obsidian"
if [ ! -x "$OBS_BIN" ]; then
  echo "[s0] downloading Obsidian $OBS_VERSION ..."
  curl -fsSL -o "$OBSDIR/obsidian.tar.gz" \
    "https://github.com/obsidianmd/obsidian-releases/releases/download/v$OBS_VERSION/obsidian-$OBS_VERSION.tar.gz"
  tar xzf "$OBSDIR/obsidian.tar.gz" -C "$OBSDIR"
fi
echo "[s0] obsidian binary: $OBS_BIN"

# 2) スパイク Vault（数値/文字列/タグ/boolean/absent を網羅）
printf -- '---\nflag: true\n---\n# Bool note\n'                 > "$VAULT/bool-note.md"
printf -- '---\nscore: 3\n---\n# Num note\n'                    > "$VAULT/num-note.md"
printf -- '---\nlevel: high\n---\n# Str note\n'                 > "$VAULT/str-note.md"
printf -- '---\ntags:\n  - urgent\n  - work\n---\n# Tag note\n' > "$VAULT/tag-note.md"
printf -- '---\nmisc: x\n---\n# Absent note\n'                  > "$VAULT/absent-note.md"
cat > "$VAULT/Probe.base" <<YAML
views:
  - type: $VIEW_TYPE
    name: Probe
    urgentProperty: note.urgent
    importantProperty: note.important
YAML
cp "$PLUGIN_DIR_SRC/main.js" "$PLUGIN_DIR_SRC/manifest.json" "$PLUGIN_DIR_SRC/styles.css" "$PLUGDIR/" 2>/dev/null || \
  cp "$PLUGIN_MAIN" "$PLUGDIR/main.js"

python3 - "$VAULT" <<'PY'
import json, sys, os
od = os.path.join(sys.argv[1], ".obsidian")
json.dump({"file-explorer": True, "bases": True, "properties": True},
          open(os.path.join(od,"core-plugins.json"),"w"))
json.dump(["eisenhower-bases-view"], open(os.path.join(od,"community-plugins.json"),"w"))
json.dump({}, open(os.path.join(od,"app.json"),"w"))
PY
python3 - "$VAULT" "$HOMEDIR" <<'PY'
import json, sys, os
json.dump({"vaults": {"s0vault00000001": {"path": sys.argv[1], "ts": 1700000000000, "open": True}}},
          open(os.path.join(sys.argv[2], ".config/obsidian/obsidian.json"),"w"))
PY

# 3) playwright（Electron の chromium を使う＝ブラウザ DL 不要）
if [ ! -d "$HERE/node_modules/playwright" ]; then
  echo "[s0] installing playwright ..."
  (cd "$HERE" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i >/dev/null 2>&1)
fi

# 4) Obsidian 起動（CDP）→ プローブ
echo "[s0] launching obsidian --remote-debugging-port=$CDP_PORT ..."
HOME="$HOMEDIR" XDG_CONFIG_HOME="$HOMEDIR/.config" \
  nohup "$OBS_BIN" --no-sandbox --disable-gpu --remote-debugging-port="$CDP_PORT" "$VAULT" \
  > "$OUT/obs-stdout.log" 2>&1 &
OBSPID=$!
cleanup() { kill "$OBSPID" 2>/dev/null || true; pkill -P "$OBSPID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  curl -s --max-time 2 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  sleep 1
done

if VAULT="$VAULT" OUT="$OUT" CDP="http://127.0.0.1:$CDP_PORT" node "$HERE/probe-s0.js"; then
  RC=0
else
  RC=$?
fi
echo "[s0] done rc=$RC  outputs in: $OUT"
echo "[s0]   probe-s0-result.json / probe-s0-console.log"
exit $RC
