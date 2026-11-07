// Applies the site address to the Android project: the verified web-link (App Link) host, the paperly:// scheme,
// and public/.well-known/assetlinks.json. Safe to run again. Usage:
//   CAP_SERVER_URL=https://your-site ANDROID_SHA256_CERT=AA:BB:... npm run android:config
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const url = new URL((process.env.CAP_SERVER_URL ?? "https://paperly-ashy.vercel.app").replace(/\/+$/, ""));
const appId = process.env.CAP_APP_ID ?? "com.paperly.admin";
const fingerprints = (process.env.ANDROID_SHA256_CERT ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
if (url.protocol !== "https:") throw new Error("CAP_SERVER_URL must be https");

// 1. Manifest: web links for the admin pages only (verified, no chooser) plus the paperly:// scheme. Public links keep opening in the browser.
const mf = "android/app/src/main/AndroidManifest.xml";
let x = readFileSync(mf, "utf8");
const block = `<!-- deep-links:start (written by scripts/android-configure.mjs) -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${url.host}" android:pathPrefix="/admin" />
                <data android:scheme="https" android:host="${url.host}" android:pathPrefix="/founder" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="paperly" />
            </intent-filter>
            <!-- deep-links:end -->`;
if (x.includes("deep-links:start")) x = x.replace(/<!-- deep-links:start[\s\S]*?deep-links:end -->/, block);
else x = x.replace(/(<category android:name="android.intent.category.LAUNCHER" \/>\s*<\/intent-filter>)/, `$1\n\n            ${block}`);
// Nothing stored in the app should be copied into a cloud backup (the session lives in the WebView).
x = x.replace('android:allowBackup="true"', 'android:allowBackup="false"');
if (!x.includes("usesCleartextTraffic")) x = x.replace("<application", '<application\n        android:usesCleartextTraffic="false"');
writeFileSync(mf, x);

// 2. Digital Asset Links: lets Android trust that this app may open the site's links.
mkdirSync("public/.well-known", { recursive: true });
const links = [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: appId, sha256_cert_fingerprints: fingerprints } }];
writeFileSync("public/.well-known/assetlinks.json", JSON.stringify(links, null, 2) + "\n");
console.log(`Deep links: https://${url.host}/admin, /founder and paperly://  |  package ${appId}`);
if (fingerprints.length === 0) console.warn("ANDROID_SHA256_CERT is empty: web links open in the app only after the signing fingerprint is added (see docs/ANDROID.md).");
if (!existsSync("android")) throw new Error("android/ is missing: run npx cap add android first");
