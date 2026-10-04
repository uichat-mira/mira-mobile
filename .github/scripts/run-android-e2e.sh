#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${MIRA_E2E_ARTIFACT_DIR:-e2e-artifacts}"
APK_DIR="${MIRA_E2E_APK_DIR:-e2e-apk}"
mkdir -p "$ARTIFACT_DIR" "$ARTIFACT_DIR/maestro-output"

fixture_pid=''
metro_pid=''

cleanup() {
  if [ -n "$fixture_pid" ]; then kill "$fixture_pid" 2>/dev/null || true; fi
  if [ -n "$metro_pid" ]; then kill "$metro_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"
  local label="$2"
  local attempts="$3"
  for ((i=1; i<=attempts; i++)); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "$label did not become ready: $url" >&2
  return 1
}

apk_path=$(find "$APK_DIR" -type f -name '*.apk' -print -quit)
if [ -z "$apk_path" ]; then
  echo "No Android APK found under $APK_DIR" >&2
  exit 1
fi

adb wait-for-device
adb logcat -c || true
adb reverse tcp:8081 tcp:8081
adb reverse tcp:8787 tcp:8787

node scripts/e2e/host-fixture.cjs >"$ARTIFACT_DIR/host-fixture.log" 2>&1 &
fixture_pid=$!
if ! wait_for_url "http://127.0.0.1:8787/health" "Host fixture" 30; then
  cat "$ARTIFACT_DIR/host-fixture.log" >&2 || true
  exit 1
fi

npm start -- --port 8081 >"$ARTIFACT_DIR/metro.log" 2>&1 &
metro_pid=$!
if ! wait_for_url "http://127.0.0.1:8081/status" "Metro" 90; then
  tail -n 200 "$ARTIFACT_DIR/metro.log" >&2 || true
  exit 1
fi

adb install -r "$apk_path"

export MIRA_E2E_ANDROID_API
MIRA_E2E_ANDROID_API=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
export MIRA_E2E_DEVICE_MODEL
MIRA_E2E_DEVICE_MODEL=$(adb shell getprop ro.product.model | tr -d '\r')
export MIRA_E2E_DEVICE_SERIAL
MIRA_E2E_DEVICE_SERIAL=$(adb get-serialno | tr -d '\r')
export MIRA_E2E_APK_SHA256
MIRA_E2E_APK_SHA256=$(sha256sum "$apk_path" | awk '{print $1}')
export MIRA_E2E_MAESTRO_VERSION
MIRA_E2E_MAESTRO_VERSION=$(maestro --version | tr -d '\r')

{
  echo "tested_commit_sha=$GITHUB_SHA"
  echo "android_api=$MIRA_E2E_ANDROID_API"
  echo "device_model=$MIRA_E2E_DEVICE_MODEL"
  echo "device_serial=$MIRA_E2E_DEVICE_SERIAL"
  echo "maestro_version=$MIRA_E2E_MAESTRO_VERSION"
  echo "apk_sha256=$MIRA_E2E_APK_SHA256"
  echo "apk_source=uichat-mira-mobile-android-debug"
  echo "apk_reused_for_all_flows=true"
} >"$ARTIFACT_DIR/metadata.txt"

set +e
maestro test \
  --format junit \
  --output "$ARTIFACT_DIR/maestro-junit.xml" \
  --test-output-dir="$ARTIFACT_DIR/maestro-output" \
  --debug-output="$ARTIFACT_DIR/maestro-output" \
  .maestro/flows
maestro_status=$?
set -e

adb logcat -d >"$ARTIFACT_DIR/android-logcat.txt" 2>&1 || true
node scripts/e2e/summarize-maestro.cjs \
  "$ARTIFACT_DIR/maestro-junit.xml" \
  "$ARTIFACT_DIR/summary.md" \
  "$maestro_status" || true

cat "$ARTIFACT_DIR/summary.md" || true
exit "$maestro_status"
