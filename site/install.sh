#!/bin/bash
# skrape installer.   curl -fsSL https://skrape.abovetopsecret.ai/install | bash
# Makes sure Node 22.13+ is there, installs skrape from npm, offers the video tools, launches.
set -e
PKG="${SKRAPE_PKG:-@mogulmoretti/skrape@latest}"
G=$'\033[92m'; D=$'\033[32m'; Y=$'\033[33m'; R=$'\033[91m'; N=$'\033[0m'; B=$'\033[1m'
TTY=/dev/tty; { : < $TTY; } 2>/dev/null || TTY=/dev/null
LOG=$(mktemp)

say()  { printf '%s\n' "$*"; }
fail() { kill $ANIM 2>/dev/null; printf '\n\n%s  ✗ %s%s\n' "$R" "$*" "$N"; [ -s "$LOG" ] && printf '%s    last output:%s\n' "$D" "$N" && tail -5 "$LOG" | sed 's/^/    /'; echo; exit 1; }
bar()  { local w=34; local p=$(( $1 * w / 100 )); [ $p -gt $w ] && p=$w
  printf '\r  %s[%s%s%s%s]%s %3d%%' "$D" "$G" "$(printf "%${p}s" | tr ' ' '█')" "$D" "$(printf "%$((w - p))s" | tr ' ' '░')" "$N" "$1"; }
# One bar for the whole install. Stages raise a target; the animator glides toward it one step at a time.
PROG=$(mktemp); echo 0 > "$PROG"
target() { echo "$1" > "$PROG"; }
finish() { target 100; wait $ANIM 2>/dev/null || true; echo; }

clear 2>/dev/null || true
printf '%s%b%s\n' "$G" '
  ▄▄▄ ▄  ▄ ▄▄▄   ▄▄  ▄▄▄  ▄▄▄
  ▀▄  █▄▀  █▄▀  █▄▄█ █▄█  █▄
  ▄▄▀ █ ▀▄ █ ▀▄ █  █ █    █▄▄' "$N"
say "  ${D}read the course, skip the video${N}"
echo

( cur=0; while :; do t=$(cat "$PROG" 2>/dev/null || echo 100)
    if [ "$cur" -lt "$t" ]; then cur=$((cur + 1)); bar "$cur"; fi
    [ "$cur" -ge 100 ] && break; sleep 0.03; done ) & ANIM=$!

case "$(uname -s)" in Darwin|Linux) ;; *) fail "skrape runs on macOS or Linux." ;; esac
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
has() { command -v "$1" >/dev/null 2>&1; }

# node: 0-30. Needs 22.13+, the first Node with built-in SQLite on by default; checked directly.
node_ok() { node -e "require('node:sqlite')" >/dev/null 2>&1; }
target 10
if ! node_ok; then
  if has brew; then
    brew install node >>"$LOG" 2>&1 || brew upgrade node >>"$LOG" 2>&1 || fail "Could not install Node with Homebrew."
    hash -r
  fi
  node_ok || fail "skrape needs Node 22.13 or newer. Get it from https://nodejs.org, then run this again."
fi
target 30

# skrape: 30-95
npm install -g "$PKG" --no-fund --no-audit >>"$LOG" 2>&1 & NPM=$!
n=30; while kill -0 $NPM 2>/dev/null; do [ $n -lt 90 ] && n=$((n + 1)) && target $n; sleep 0.4; done
if ! wait $NPM; then
  grep -q EACCES "$LOG" && fail "npm can't write to its global folder. Run: sudo npm install -g $PKG  (or install Node with Homebrew or nvm, then run this again)."
  fail "npm install failed."
fi
BIN="$(npm prefix -g)/bin/skrape"
[ -x "$BIN" ] || BIN=$(command -v skrape) || fail "Installed, but the skrape command was not found on your PATH."
finish

say "  ${G}✓${N} skrape $("$BIN" --version) installed"

# Video downloads are optional and need yt-dlp + ffmpeg.
if has yt-dlp; then
  say "  ${G}✓${N} video downloads ready (yt-dlp found)"
elif has brew && [ "$TTY" != /dev/null ]; then
  printf '\n  Set up video downloads too? Installs yt-dlp and ffmpeg with Homebrew. %s[y/N]%s ' "$B" "$N"
  read -r ans < $TTY || ans=
  if [[ "$ans" =~ ^[Yy] ]]; then
    printf '  %sinstalling, this can take a minute…%s\n' "$D" "$N"
    if brew install yt-dlp ffmpeg >>"$LOG" 2>&1; then say "  ${G}✓${N} video downloads ready"
    else say "  ${Y}!${N} Homebrew could not install them. Transcripts still work; see $LOG"; fi
  fi
else
  say "  ${D}· for video downloads, install yt-dlp: https://github.com/yt-dlp/yt-dlp#installation${N}"
fi
rm -f "$PROG"

echo
if [ "$TTY" != /dev/null ]; then
  say "  ${D}starting skrape…${N}"; echo
  exec "$BIN" < $TTY
fi
say "  Run ${B}skrape${N} to start."
