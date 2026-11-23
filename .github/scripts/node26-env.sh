#!/bin/sh
# Resolve the Node 26 LTS runtime used by the repository-owned `mobile-feature`
# Validation Profile.
#
# The Validation runner is a separate trusted job and does not run
# actions/setup-node. Prefer the runner's preinstalled tool cache, then fall
# back to the official Node distribution with checksum verification. Node is a
# validation tool only; it is never bundled into the Android/iOS app.
#
# Usage (POSIX shell): . .github/scripts/node26-env.sh
set -e

MIRA_NODE_VERSION="${MIRA_NODE_VERSION:-26.13.1}"
MIRA_NODE_MAJOR="${MIRA_NODE_VERSION%%.*}"

node_bin="$(find /opt/hostedtoolcache/node -path "*/${MIRA_NODE_MAJOR}.*/x64/bin/node" -print 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$node_bin" ] && [ -x "$node_bin" ]; then
  PATH="$(dirname "$node_bin"):$PATH"
  export PATH
else
  install_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mira-node-${MIRA_NODE_VERSION}"
  node_bin="$install_root/node-v${MIRA_NODE_VERSION}-linux-x64/bin/node"
  if [ ! -x "$node_bin" ]; then
    archive="node-v${MIRA_NODE_VERSION}-linux-x64.tar.xz"
    dist_url="https://nodejs.org/dist/v${MIRA_NODE_VERSION}"
    mkdir -p "$install_root"
    curl -fsSL --retry 3 --proto '=https' --tlsv1.2 \
      "$dist_url/SHASUMS256.txt" -o "$install_root/SHASUMS256.txt"
    expected="$(awk -v file="$archive" '$2 == file { print $1 }' "$install_root/SHASUMS256.txt")"
    test -n "$expected"
    curl -fsSL --retry 3 --proto '=https' --tlsv1.2 \
      "$dist_url/$archive" -o "$install_root/$archive"
    printf '%s  %s\n' "$expected" "$install_root/$archive" | sha256sum -c -
    tar -xJf "$install_root/$archive" -C "$install_root"
    rm -f "$install_root/$archive"
  fi
  PATH="$(dirname "$node_bin"):$PATH"
  export PATH
fi

node --version
