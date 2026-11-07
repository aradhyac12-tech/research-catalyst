# Paperly Admin: Android app (Capacitor)

This app is for administrators only. It opens straight on `/admin`, has no sign-up, no public footer or banners, and sends any other page (the public site, author pages) back to `/admin`. Someone signing in without admin or editor rights sees "Your account cannot access this panel".

The app is a native shell around the live site (`CAP_SERVER_URL`, default `https://paperly-ashy.vercel.app`), so every site change shows up in the app without a new APK. Package: `com.paperly.admin`.

## What this app is
A hosted-site shell, not a standalone bundle. The site renders on a server and its server functions run there, so the APK opens the live site (`CAP_SERVER_URL`) in a native window instead of carrying a copy. `mobile/www` holds only the offline screen. Tools that expect a static build in `mobile/www` will report it as not packageable; build it with the steps below instead. The one lockfile is `bun.lock` (installs use `bun install --frozen-lockfile`).

## Build
Needs Node 22, JDK 21 and the Android SDK, or use the GitHub workflow `Android APK` (Actions > Run workflow), which needs none of that.
```
bun install --frozen-lockfile
bun run android:config      # writes the deep-link host and public/.well-known/assetlinks.json
bun run android:debug       # android/app/build/outputs/apk/debug/app-debug.apk
```

## Release APK (once)
1. `./scripts/android-keystore.sh` creates the signing key and prints its SHA-256 fingerprint. Back the `.jks` file and password up; they cannot be recovered.
2. `ANDROID_SHA256_CERT=<fingerprint> bun run android:config`, commit `public/.well-known/assetlinks.json`, and deploy the site. It must open at `https://<site>/.well-known/assetlinks.json`.
3. `bun run android:release`. In GitHub instead: set repository variable `ANDROID_SHA256_CERT`, and secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 android/paperly-release.jks`) and `ANDROID_KEYSTORE_PASSWORD`.

## Deep links
- `https://<site>/admin...` and `https://<site>/founder...` open in the app (verified App Link, no chooser) once step 2 is done. Until then Android opens the browser instead. Public links (articles, the home page) are not claimed, so they keep opening in the browser.
- `paperly://admin`, `paperly://founder` always open in the app.
- Only this site's links and `paperly://` are accepted; anything else is ignored.
- Test: `adb shell am start -a android.intent.action.VIEW -d "https://<site>/admin"`, and `adb shell pm get-app-links com.paperly.admin` to see verification.

## Sign-in storage and PKCE
Inside the app only (the website is unchanged), Supabase signs in with PKCE, so Google returns a one-time `?code=` that a deep link keeps (a `#fragment` can be dropped), and the app exchanges it for the session. The session is kept in the phone's preference store (`@capacitor/preferences`) with a localStorage copy, so clearing the WebView's storage does not sign people out. See `src/lib/native-storage.ts` and the marked block in `src/integrations/supabase/client.ts`.

## Google sign-in
Google blocks sign-in inside an app's built-in browser, so the app opens it in the phone's browser and returns via `paperly://auth/callback?code=...`. Add `paperly://**` to Supabase > Authentication > URL configuration > Redirect URLs. Email sign-in, ORCID and Zenodo run inside the app.

## Changing the site address
Set `CAP_SERVER_URL`, run `bun run android:config` and `npx cap sync android`. A changed package name (`CAP_APP_ID`) needs the android folder recreated.
