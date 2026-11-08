#!/usr/bin/env bash
# Creates the release signing key ONCE and prints the SHA-256 fingerprint the website needs. Keep the .jks and passwords safe:
# losing them means you can never update the app on Google Play. Never commit them (.gitignore already excludes them).
set -euo pipefail
OUT="${1:-android/paperly-release.jks}"
[ -e "$OUT" ] && { echo "$OUT already exists, not overwriting"; exit 1; }
read -rsp "Choose a keystore password: " PW; echo
keytool -genkeypair -v -keystore "$OUT" -alias paperly -keyalg RSA -keysize 2048 -validity 10000 -storepass "$PW" -keypass "$PW" -dname "CN=Paperly, O=Paperly, C=IN"
printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=paperly\nkeyPassword=%s\n' "$(basename "$OUT")" "$PW" "$PW" > android/keystore.properties
echo; echo "SHA-256 fingerprint (use as ANDROID_SHA256_CERT):"
keytool -list -v -keystore "$OUT" -alias paperly -storepass "$PW" | grep "SHA256:" | sed 's/.*SHA256: //'
