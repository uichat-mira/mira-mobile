#!/usr/bin/env bash
set -euo pipefail

channel=${1:-}
asset_dir=${2:-release-assets}

case "$channel" in
  predev|dev|test|prod) ;;
  *)
    echo "Unsupported release channel: $channel" >&2
    exit 1
    ;;
esac

for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY R2_ACCOUNT_ID R2_BUCKET; do
  if [ -z "${!name:-}" ]; then
    echo "Required R2 environment variable is missing: $name" >&2
    exit 1
  fi
done

apk="$asset_dir/uichat-mira-mobile-release.apk"
checksum="$asset_dir/uichat-mira-mobile-release.apk.sha256"
manifest="$asset_dir/latest.json"

for file in "$apk" "$checksum" "$manifest"; do
  if [ ! -s "$file" ]; then
    echo "Required release truth file is missing or empty: $file" >&2
    exit 1
  fi
done

(
  cd "$asset_dir"
  sha256sum -c uichat-mira-mobile-release.apk.sha256
)

version=$(node -e "const m=require('./${manifest}'); process.stdout.write(m.version)")
manifest_channel=$(node -e "const m=require('./${manifest}'); process.stdout.write(m.channel)")
if [ "$manifest_channel" != "$channel" ]; then
  echo "Manifest channel mismatch: expected=$channel actual=$manifest_channel" >&2
  exit 1
fi

endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
channel_root="mira/mobile/${channel}"
release_prefix="${channel_root}/releases/${version}"
latest_prefix="${channel_root}/latest"
release_apk_key="${release_prefix}/uichat-mira-mobile-release.apk"
release_checksum_key="${release_prefix}/uichat-mira-mobile-release.apk.sha256"

# Return codes: 0 = exists, 1 = explicitly missing, 2 = lookup failed.
# A transport/auth/API failure must never be treated as permission to overwrite
# an immutable branch+version object.
object_state() {
  local key=$1
  local output
  local status

  set +e
  output=$(aws s3api head-object \
    --bucket "$R2_BUCKET" \
    --key "$key" \
    --endpoint-url "$endpoint" \
    2>&1)
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    return 0
  fi
  if printf '%s' "$output" | grep -Eq '(404|Not Found|NoSuchKey)'; then
    return 1
  fi

  echo "Unable to determine R2 object state for $key: $output" >&2
  return 2
}

object_size() {
  aws s3api head-object \
    --bucket "$R2_BUCKET" \
    --key "$1" \
    --endpoint-url "$endpoint" \
    --query ContentLength \
    --output text
}

verify_object_size() {
  local file=$1
  local key=$2
  local local_size
  local remote_size
  local_size=$(stat -c '%s' "$file")
  remote_size=$(object_size "$key")
  if [ "$local_size" != "$remote_size" ]; then
    echo "R2 verification failed for $key: local=$local_size remote=$remote_size" >&2
    return 1
  fi
}

verify_existing_version() {
  local local_digest
  local remote_checksum_digest
  local remote_apk_digest

  local_digest=$(awk '{print $1}' "$checksum")
  remote_checksum_digest=$(aws s3 cp \
    "s3://${R2_BUCKET}/${release_checksum_key}" - \
    --endpoint-url "$endpoint" \
    --only-show-errors \
    | awk '{print $1}')
  remote_apk_digest=$(aws s3 cp \
    "s3://${R2_BUCKET}/${release_apk_key}" - \
    --endpoint-url "$endpoint" \
    --only-show-errors \
    | sha256sum \
    | awk '{print $1}')

  if [ "$local_digest" != "$remote_checksum_digest" ] \
    || [ "$local_digest" != "$remote_apk_digest" ]; then
    echo "Version collision for ${channel}/${version}: immutable R2 release already contains different APK bytes. Bump package.json.version before publishing." >&2
    return 1
  fi

  echo "Reusing identical immutable R2 release: ${channel}/${version}"
}

publish_new_versioned_assets() {
  for attempt in 1 2 3; do
    if aws s3 cp "$apk" "s3://${R2_BUCKET}/${release_apk_key}" \
        --endpoint-url "$endpoint" \
        --cache-control 'public, max-age=31536000, immutable' \
        --only-show-errors \
      && aws s3 cp "$checksum" "s3://${R2_BUCKET}/${release_checksum_key}" \
        --endpoint-url "$endpoint" \
        --cache-control 'public, max-age=31536000, immutable' \
        --only-show-errors \
      && verify_object_size "$apk" "$release_apk_key" \
      && verify_object_size "$checksum" "$release_checksum_key"; then
      return 0
    fi

    echo "R2 immutable asset publication attempt ${attempt} failed." >&2
    # These keys were confirmed absent before this publication attempt. Remove
    # a partial upload before retrying so an interrupted first attempt cannot be
    # mistaken for a pre-existing immutable release.
    aws s3 rm "s3://${R2_BUCKET}/${release_apk_key}" \
      --endpoint-url "$endpoint" --only-show-errors >/dev/null 2>&1 || true
    aws s3 rm "s3://${R2_BUCKET}/${release_checksum_key}" \
      --endpoint-url "$endpoint" --only-show-errors >/dev/null 2>&1 || true

    if [ "$attempt" -lt 3 ]; then
      sleep $((attempt * 10))
    fi
  done

  echo 'R2 immutable release publication failed after 3 attempts; latest.json was not changed.' >&2
  return 1
}

apk_exists=false
checksum_exists=false
if object_state "$release_apk_key"; then
  apk_exists=true
else
  state=$?
  if [ "$state" -ne 1 ]; then exit 1; fi
fi
if object_state "$release_checksum_key"; then
  checksum_exists=true
else
  state=$?
  if [ "$state" -ne 1 ]; then exit 1; fi
fi

if [ "$apk_exists" = true ] || [ "$checksum_exists" = true ]; then
  if [ "$apk_exists" != true ] || [ "$checksum_exists" != true ]; then
    echo "Incomplete immutable R2 release already exists for ${channel}/${version}; refusing to overwrite it." >&2
    exit 1
  fi
  verify_existing_version
else
  publish_new_versioned_assets
fi

upload_latest_mirrors() {
  aws s3 cp "$apk" "s3://${R2_BUCKET}/${latest_prefix}/uichat-mira-mobile-release.apk" \
    --endpoint-url "$endpoint" \
    --cache-control 'public, max-age=300, must-revalidate' \
    --only-show-errors
  aws s3 cp "$checksum" "s3://${R2_BUCKET}/${latest_prefix}/uichat-mira-mobile-release.apk.sha256" \
    --endpoint-url "$endpoint" \
    --cache-control 'public, max-age=300, must-revalidate' \
    --only-show-errors
}

verify_latest_mirrors() {
  verify_object_size "$apk" "${latest_prefix}/uichat-mira-mobile-release.apk"
  verify_object_size "$checksum" "${latest_prefix}/uichat-mira-mobile-release.apk.sha256"
}

mirrors_published=false
for attempt in 1 2 3; do
  if upload_latest_mirrors && verify_latest_mirrors; then
    mirrors_published=true
    break
  fi
  echo "R2 latest mirror publication attempt ${attempt} failed." >&2
  if [ "$attempt" -lt 3 ]; then
    sleep $((attempt * 10))
  fi
done

if [ "$mirrors_published" != true ]; then
  echo 'R2 latest mirrors failed after 3 attempts; latest.json was not changed.' >&2
  exit 1
fi

# Atomic client pointer: publish only after the immutable branch+version APK and
# checksum have been proven stable and the human-facing latest mirrors succeed.
manifest_key="${latest_prefix}/latest.json"
aws s3 cp "$manifest" "s3://${R2_BUCKET}/${manifest_key}" \
  --endpoint-url "$endpoint" \
  --cache-control 'public, max-age=60, must-revalidate' \
  --only-show-errors
verify_object_size "$manifest" "$manifest_key"

echo "Published R2 release truth: ${channel}/${version}"
