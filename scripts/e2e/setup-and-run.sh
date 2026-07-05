#!/usr/bin/env bash
# 実機 Obsidian で Bases カスタムビュー往復を自動検証する E2E ハーネス。
# 詳細は scripts/e2e/README.md。Issue #16（着手前スパイク）の自動検証に使用。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"

OBS_VERSION="${OBS_VERSION:-1.12.7}"
PLUGIN_MAIN="${PLUGIN_MAIN:-$REPO_ROOT/main.js}"
VIEW_TYPE="${VIEW_TYPE:-eisenhower-matrix}"
CDP_PORT="${CDP_PORT:-9222}"
WORK="${WORK:-$(mktemp -d -t obs-e2e-XXXXXX)}"

OUT="$WORK/out"; OBSDIR="$WORK/obs"; VAULT="$WORK/vault"; HOMEDIR="$WORK/home"
PLUGDIR="$VAULT/.obsidian/plugins/eisenhower-bases-view"
mkdir -p "$OUT" "$OBSDIR" "$PLUGDIR" "$HOMEDIR/.config/obsidian"

echo "[e2e] WORK=$WORK  OBS=$OBS_VERSION  VIEW_TYPE=$VIEW_TYPE"

[ -f "$PLUGIN_MAIN" ] || { echo "[e2e] ERROR: $PLUGIN_MAIN がありません。先に 'npm run build' を実行してください。"; exit 1; }
PLUGIN_DIR_SRC="$(dirname "$PLUGIN_MAIN")"

# 1) Obsidian 取得（tar.gz を展開＝Electron バイナリ）
OBS_BIN="$OBSDIR/obsidian-$OBS_VERSION/obsidian"
if [ ! -x "$OBS_BIN" ]; then
  echo "[e2e] downloading Obsidian $OBS_VERSION ..."
  curl -fsSL -o "$OBSDIR/obsidian.tar.gz" \
    "https://github.com/obsidianmd/obsidian-releases/releases/download/v$OBS_VERSION/obsidian-$OBS_VERSION.tar.gz"
  tar xzf "$OBSDIR/obsidian.tar.gz" -C "$OBSDIR"
fi
echo "[e2e] obsidian binary: $OBS_BIN"

# 2) テスト Vault（absent/false/true/非 boolean/フォルダを網羅）
mkdir -p "$VAULT/Project"
printf -- '---\nurgent: true\nimportant: true\n---\n# Do\n'       > "$VAULT/do.md"
printf -- '---\nurgent: false\nimportant: true\n---\n# Schedule\n' > "$VAULT/schedule.md"
printf -- '---\nurgent: true\nimportant: false\n---\n# Delegate\n' > "$VAULT/delegate.md"
printf -- '---\nurgent: false\nimportant: false\n---\n# Delete\n'  > "$VAULT/delete.md"
printf -- '---\ntag: misc\n---\n# Absent\n'                        > "$VAULT/absent.md"
printf -- '---\nurgent: true\n---\n# Partial\n'                    > "$VAULT/partial.md"
printf -- '---\nurgent: 3\nimportant: true\n---\n# Numeric\n'      > "$VAULT/numeric.md"
printf -- '---\nurgent: true\nimportant: true\n---\n# In folder\n' > "$VAULT/Project/infolder.md"
cat > "$VAULT/Eisenhower.base" <<YAML
views:
  - type: $VIEW_TYPE
    name: Eisenhower
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
json.dump({"vaults": {"e2evault00000001": {"path": sys.argv[1], "ts": 1700000000000, "open": True}}},
          open(os.path.join(sys.argv[2], ".config/obsidian/obsidian.json"),"w"))
PY

# 3) playwright（ブラウザバイナリ不要＝Electron の chromium を使う）
if [ ! -d "$HERE/node_modules/playwright" ]; then
  echo "[e2e] installing playwright ..."
  (cd "$HERE" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i >/dev/null 2>&1)
fi

# 4) Obsidian 起動（CDP）→ ハーネス実行
echo "[e2e] launching obsidian with --remote-debugging-port=$CDP_PORT ..."
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

VAULT="$VAULT" OUT="$OUT" CDP="http://127.0.0.1:$CDP_PORT" node "$HERE/run-cdp.js"
RC=$?
echo "[e2e] done rc=$RC  outputs in: $OUT"
exit $RC
