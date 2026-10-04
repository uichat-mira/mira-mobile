#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${GITHUB_WORKSPACE:-$(pwd)}"
ARTIFACT_DIR="${MIRA_E2E_ARTIFACT_DIR:-$ROOT_DIR/artifacts/android-maestro}"
APK_PATH="${MIRA_E2E_APK:-$ROOT_DIR/e2e-input/uichat-mira-mobile-dev.apk}"
FIXTURE_PORT="${MIRA_E2E_HOST_PORT:-8787}"
APP_ID="io.tomz.mira.mobile"
PAIRING_URI="mira://pair?host=http%3A%2F%2F10.0.2.2%3A${FIXTURE_PORT}&challenge=mob-059&code=ABCD2345&version=1"

mkdir -p "$ARTIFACT_DIR"
: > "$ARTIFACT_DIR/results.tsv"

fixture_pid=""
metro_pid=""

cleanup() {
  if [[ -n "$metro_pid" ]]; then kill "$metro_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

if [[ ! -s "$APK_PATH" ]]; then
  echo "Android debug artifact is missing: $APK_PATH" >&2
  exit 1
fi

sha256sum "$APK_PATH" | tee "$ARTIFACT_DIR/apk.sha256"
{
  echo "commit_sha=${GITHUB_SHA:-unknown}"
  echo "apk_path=$APK_PATH"
  echo "apk_sha256=$(sha256sum "$APK_PATH" | awk '{print $1}')"
  echo "maestro_version=$(maestro --version 2>&1 | tr '\n' ' ')"
  echo "adb_serial=$(adb get-serialno)"
  echo "android_api=$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  echo "android_release=$(adb shell getprop ro.build.version.release | tr -d '\r')"
  echo "device_model=$(adb shell getprop ro.product.model | tr -d '\r')"
  echo "device_name=$(adb shell getprop ro.product.device | tr -d '\r')"
  echo "failure_probe=${MIRA_E2E_FAILURE_PROBE:-0}"
} | tee "$ARTIFACT_DIR/metadata.txt"

node "$ROOT_DIR/.github/e2e/host-fixture.cjs" >"$ARTIFACT_DIR/fixture.log" 2>&1 &
fixture_pid=$!

(
  cd "$ROOT_DIR"
  npm start -- --port 8081 >"$ARTIFACT_DIR/metro.log" 2>&1
) &
metro_pid=$!

wait_http() {
  local url="$1"
  local name="$2"
  for _ in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "$name did not become ready at $url" >&2
  return 1
}

wait_http "http://127.0.0.1:${FIXTURE_PORT}/health" "Host fixture"
wait_http "http://127.0.0.1:8081/status" "Metro"

adb wait-for-device
adb reverse tcp:8081 tcp:8081
adb uninstall "$APP_ID" >/dev/null 2>&1 || true
adb install -r "$APK_PATH"

# Start the real product pairing route through Android's public deep-link surface.
adb shell "am start -W -a android.intent.action.VIEW -d '$PAIRING_URI' $APP_ID"   >"$ARTIFACT_DIR/pairing-intent.txt" 2>&1

flows=(
  "$ROOT_DIR/.maestro/android/00-pair-and-thread-list.yaml"
  "$ROOT_DIR/.maestro/android/01-settings-navigation.yaml"
  "$ROOT_DIR/.maestro/android/02-open-thread.yaml"
  "$ROOT_DIR/.maestro/android/03-create-thread.yaml"
)

if [[ "${MIRA_E2E_FAILURE_PROBE:-0}" == "1" ]]; then
  probe_flow="$ARTIFACT_DIR/deliberate-failure-probe.yaml"
  cat >"$probe_flow" <<'YAML'
appId: io.tomz.mira.mobile
---
- assertVisible: "MOB-059 deliberate failure probe should never be visible"
YAML
  flows+=("$probe_flow")
fi

failed=0
for flow in "${flows[@]}"; do
  flow_name="$(basename "$flow")"
  base="${flow_name%.yaml}"
  log="$ARTIFACT_DIR/${base}.maestro.log"

  echo "=== Maestro flow: $flow_name ==="
  set +e
  timeout 150s maestro test "$flow" >"$log" 2>&1
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    result="PASS"
  else
    result="FAIL"
    failed=1
    adb exec-out screencap -p >"$ARTIFACT_DIR/${base}.failure.png" || true
    adb shell uiautomator dump /sdcard/mob059-window.xml >/dev/null 2>&1 || true
    adb pull /sdcard/mob059-window.xml "$ARTIFACT_DIR/${base}.window.xml" >/dev/null 2>&1 || true
    adb logcat -d -v threadtime >"$ARTIFACT_DIR/${base}.logcat.txt" || true
  fi

  printf '%s\t%s\t%s\n' "$flow_name" "$result" "$status" >>"$ARTIFACT_DIR/results.tsv"
  echo "$flow_name => $result (exit=$status)"
done

adb logcat -d -v threadtime >"$ARTIFACT_DIR/device-logcat.txt" || true

{
  echo "# MOB-059 Android Maestro report"
  echo
  echo "- Commit: \`${GITHUB_SHA:-unknown}\`"
  echo "- APK SHA-256: \`$(sha256sum "$APK_PATH" | awk '{print $1}')\`"
  echo "- Android API: \`$(adb shell getprop ro.build.version.sdk | tr -d '\r')\`"
  echo "- Device: \`$(adb shell getprop ro.product.model | tr -d '\r')\`"
  echo "- Build reuse: one downloaded \`uichat-mira-mobile-android-debug\` APK was installed once; flows did not invoke Gradle."
  echo
  echo "| Flow | Result | Exit |"
  echo "| --- | --- | ---: |"
  while IFS=$'\t' read -r flow_name result status; do
    echo "| \`$flow_name\` | $result | $status |"
  done <"$ARTIFACT_DIR/results.tsv"
} >"$ARTIFACT_DIR/report.md"

cat "$ARTIFACT_DIR/report.md"

if [[ "$failed" -ne 0 ]]; then
  echo "One or more Maestro critical smoke flows failed. See uploaded artifacts." >&2
  exit 1
fi
