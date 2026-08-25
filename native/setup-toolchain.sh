#!/usr/bin/env bash
# Einmalige Toolchain für den APK-Bau — ohne root, alles unter ~/Android.
# Löschen mit: rm -rf ~/Android
set -euo pipefail

ROOT="$HOME/Android"
SDK="$ROOT/Sdk"
JDK="$ROOT/jdk-21"
mkdir -p "$ROOT"

# Gradle 8.14 (das Capacitor mitbringt) baut nicht mit JDK 25. Deshalb ein
# eigenes JDK 21 daneben, statt am System-Java zu drehen.
if [ ! -d "$JDK" ]; then
  echo "· JDK 21 wird geholt …"
  curl -sL -o "$ROOT/jdk21.tar.gz" \
    "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
  mkdir -p "$JDK"
  tar xzf "$ROOT/jdk21.tar.gz" -C "$JDK" --strip-components=1
  rm -f "$ROOT/jdk21.tar.gz"
fi

if [ ! -d "$SDK/cmdline-tools/latest" ]; then
  echo "· Android-SDK-Werkzeuge werden geholt …"
  curl -sL -o "$ROOT/cmdline-tools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  mkdir -p "$SDK/cmdline-tools"
  unzip -q -o "$ROOT/cmdline-tools.zip" -d "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -f "$ROOT/cmdline-tools.zip"
fi

export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"
export ANDROID_HOME="$SDK"

yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" >/dev/null

echo "sdk.dir=$SDK" > "$(dirname "$0")/android/local.properties"
echo "✓ Toolchain steht. Vor dem Bauen in der Shell setzen:"
echo "    export JAVA_HOME=$JDK"
echo "    export ANDROID_HOME=$SDK"
