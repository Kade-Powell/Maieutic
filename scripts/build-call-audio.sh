#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${ROOT}/native/darwin-universal"
WORK="$(mktemp -d)"

cleanup() {
  rm -rf "${WORK}"
}
trap cleanup EXIT

mkdir -p "${OUTPUT}"
"${ROOT}/scripts/test-call-audio-detector.sh"

for arch in arm64 x86_64; do
  swiftc -target "${arch}-apple-macos12.0" \
    "${ROOT}/native/macos/CallAudioSpeechDetector.swift" \
    "${ROOT}/native/macos/MaieuticCallAudio.swift" \
    -o "${WORK}/maieutic-call-audio-${arch}" \
    -framework AVFoundation
done

lipo -create \
  "${WORK}/maieutic-call-audio-arm64" \
  "${WORK}/maieutic-call-audio-x86_64" \
  -output "${OUTPUT}/maieutic-call-audio"

chmod 0755 "${OUTPUT}/maieutic-call-audio"
codesign --force --sign - "${OUTPUT}/maieutic-call-audio"
