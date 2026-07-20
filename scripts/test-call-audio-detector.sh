#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"

cleanup() {
  rm -rf "${WORK}"
}
trap cleanup EXIT

swiftc \
  "${ROOT}/native/macos/CallAudioSpeechDetector.swift" \
  "${ROOT}/native/macos/tests/CallAudioSpeechDetectorTests.swift" \
  -o "${WORK}/call-audio-speech-detector-tests"

"${WORK}/call-audio-speech-detector-tests"
