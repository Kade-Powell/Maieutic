#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${ROOT}/native/darwin-universal"
WORK="$(mktemp -d)"
WHISPER_VERSION="v1.9.1"
WHISPER_COMMIT="f049fff95a089aa9969deb009cdd4892b3e74916"

cleanup() {
  rm -rf "${WORK}"
}
trap cleanup EXIT

mkdir -p "${OUTPUT}"

swiftc -target arm64-apple-macos12.0 \
  "${ROOT}/native/macos/MaieuticRecorder.swift" \
  -o "${WORK}/maieutic-recorder-arm64" \
  -framework AVFoundation
swiftc -target x86_64-apple-macos12.0 \
  "${ROOT}/native/macos/MaieuticRecorder.swift" \
  -o "${WORK}/maieutic-recorder-x86_64" \
  -framework AVFoundation
lipo -create \
  "${WORK}/maieutic-recorder-arm64" \
  "${WORK}/maieutic-recorder-x86_64" \
  -output "${OUTPUT}/maieutic-recorder"

swiftc -target arm64-apple-macos12.0 \
  "${ROOT}/native/macos/MaieuticCallAudio.swift" \
  -o "${WORK}/maieutic-call-audio-arm64" \
  -framework AVFoundation
swiftc -target x86_64-apple-macos12.0 \
  "${ROOT}/native/macos/MaieuticCallAudio.swift" \
  -o "${WORK}/maieutic-call-audio-x86_64" \
  -framework AVFoundation
lipo -create \
  "${WORK}/maieutic-call-audio-arm64" \
  "${WORK}/maieutic-call-audio-x86_64" \
  -output "${OUTPUT}/maieutic-call-audio"

git clone --depth 1 --branch "${WHISPER_VERSION}" \
  https://github.com/ggml-org/whisper.cpp.git "${WORK}/whisper.cpp"
test "$(git -C "${WORK}/whisper.cpp" rev-parse HEAD)" = "${WHISPER_COMMIT}"

for arch in arm64 x86_64; do
  cmake -S "${WORK}/whisper.cpp" -B "${WORK}/whisper-${arch}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES="${arch}" \
    -DGGML_NATIVE=OFF \
    -DGGML_METAL=ON \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_SERVER=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON
  cmake --build "${WORK}/whisper-${arch}" --config Release --target whisper-cli -j 8
done

lipo -create \
  "${WORK}/whisper-arm64/bin/whisper-cli" \
  "${WORK}/whisper-x86_64/bin/whisper-cli" \
  -output "${OUTPUT}/whisper-cli"

chmod 0755 "${OUTPUT}/maieutic-recorder" "${OUTPUT}/maieutic-call-audio" "${OUTPUT}/whisper-cli"
codesign --force --sign - "${OUTPUT}/maieutic-recorder"
codesign --force --sign - "${OUTPUT}/maieutic-call-audio"
codesign --force --sign - "${OUTPUT}/whisper-cli"
cp "${WORK}/whisper.cpp/LICENSE" "${ROOT}/licenses/whisper.cpp-LICENSE"
