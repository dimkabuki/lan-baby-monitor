#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
VERSION='__VERSION__'
PAYLOAD_SHA256='__PAYLOAD_SHA256__'
fail() { printf 'Installation failed: %s\n' "$*" >&2; exit 1; }
case "${PREFIX:-}" in /data/data/com.termux/files/usr|/data/user/0/com.termux/files/usr) ;; *) fail 'This installer supports official Termux only.';; esac
command -v pkg >/dev/null || fail 'Termux pkg command is unavailable.'
missing=()
command -v node >/dev/null || missing+=(nodejs-lts)
command -v tar >/dev/null || missing+=(tar)
command -v gzip >/dev/null || missing+=(gzip)
command -v awk >/dev/null || missing+=(gawk)
command -v grep >/dev/null || missing+=(grep)
for command_name in sha256sum base64 mktemp readlink mv; do command -v "$command_name" >/dev/null || { missing+=(coreutils); break; }; done
if ((${#missing[@]})); then
  printf 'Installing Termux runtime dependencies…\n'
  pkg install -y "${missing[@]}" || fail 'pkg failed. Check internet access and Termux package repositories.'
fi
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || fail 'Node 22 or newer required; update Termux packages.'
base="${BABYCAM_HOME:-$HOME/.local/share/lan-baby-monitor}"
mkdir -p "$base/versions" "$PREFIX/bin"
chmod 700 "$base"
installer_lock="$base/install.lock"
mkdir "$installer_lock" 2>/dev/null || fail 'Another installation is active. If interrupted, inspect and remove install.lock.'
stage=$(mktemp -d "$base/versions/.staging.XXXXXXXX")
activated=0
old_target=$(readlink "$base/current" 2>/dev/null || true)
cleanup() {
  if [[ $activated == 1 ]]; then
    if [[ -n "$old_target" ]]; then ln -s "$old_target" "$base/current.rollback"; mv -Tf "$base/current.rollback" "$base/current"; else rm -f "$base/current"; fi
  fi
  rm -rf "$stage"
  rmdir "$installer_lock" 2>/dev/null || true
}
trap cleanup EXIT
if [[ -e "$PREFIX/bin/babycam" ]] && ! grep -q 'LAN_BABY_MONITOR_LAUNCHER' "$PREFIX/bin/babycam"; then fail 'An unrelated babycam command exists; it was not overwritten.'; fi
awk '/^__BABYCAM_PAYLOAD_BELOW__$/{found=1;next}found{print}' "$0" | base64 -d > "$stage/payload.tar.gz" || fail 'Payload decoding failed.'
printf '%s  %s\n' "$PAYLOAD_SHA256" "$stage/payload.tar.gz" | sha256sum -c - >/dev/null || fail 'Payload checksum mismatch.'
tar -xzf "$stage/payload.tar.gz" -C "$stage"
rm "$stage/payload.tar.gz"
(cd "$stage" && sha256sum -c MANIFEST.sha256 >/dev/null) || fail 'Application file integrity check failed.'
actual_version=$(node "$stage/src/cli.js" version)
[[ "$actual_version" == "$VERSION" ]] || fail 'Version metadata mismatch.'
node -e 'import(process.argv[1]).catch(()=>process.exit(1))' "$stage/src/session.js" || fail 'Runtime dependency verification failed.'
# Validate configuration before stopping a running previous installation.
BABYCAM_HOME="$base" node "$stage/src/cli.js" doctor >/dev/null || fail 'Configuration/runtime validation failed.'
if [[ -L "$base/current" ]]; then BABYCAM_HOME="$base" node "$base/current/src/cli.js" stop || fail 'Previous server could not stop; installation left unchanged.'; fi
target="$base/versions/$VERSION-${PAYLOAD_SHA256:0:12}"
if [[ -d "$target" ]]; then
  (cd "$target" && sha256sum -c MANIFEST.sha256 >/dev/null) || fail 'Existing version directory is damaged.'
else
  mv "$stage" "$target"
fi
ln -s "$target" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
activated=1
launcher=$(mktemp "$PREFIX/bin/.babycam.XXXXXXXX")
printf '#!%s/bin/sh\n' "$PREFIX" > "$launcher"
cat >> "$launcher" <<'LAUNCHER'
# LAN_BABY_MONITOR_LAUNCHER
exec node "${BABYCAM_HOME:-$HOME/.local/share/lan-baby-monitor}/current/src/cli.js" "$@"
LAUNCHER
chmod 700 "$launcher"
mv -f "$launcher" "$PREFIX/bin/babycam"
BABYCAM_HOME="$base" node "$base/current/src/cli.js" version >/dev/null || fail 'Installed application verification failed.'
activated=0
printf 'LAN Baby Monitor %s installed. Run: babycam start\n' "$VERSION"
exit 0
__BABYCAM_PAYLOAD_BELOW__
