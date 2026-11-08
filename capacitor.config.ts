import type { CapacitorConfig } from "@capacitor/cli";

// The app is a native shell around the live site, because the site renders on the server (sign-in, payments and every
// server function need it). Change the address with CAP_SERVER_URL, then run `npm run android:config`.
const SERVER_URL = (process.env["CAP_SERVER_URL"] ?? "https://paperly-ashy.vercel.app").replace(/\/+$/, "");
const HOST = new URL(SERVER_URL).host;
// This app is the administrator panel only: it opens straight on /admin.
const START_URL = `${SERVER_URL}/admin`;

const config: CapacitorConfig = {
  appId: process.env["CAP_APP_ID"] ?? "com.paperly.admin",
  appName: "Paperly Admin",
  // Only used for the offline screen (errorPath); the real pages come from SERVER_URL.
  webDir: "mobile/www",
  server: {
    url: START_URL,
    cleartext: false,
    errorPath: "offline.html",
    // Stay inside the app for the site itself and the sign-in pages it redirects to (Supabase, ORCID, Zenodo); any other link opens outside.
    allowNavigation: [HOST, "*.supabase.co", "orcid.org", "*.orcid.org", "zenodo.org", "*.zenodo.org"],
  },
  android: { appendUserAgent: "PaperlyAdminApp", allowMixedContent: false, backgroundColor: "#ffffff", webContentsDebuggingEnabled: false },
  plugins: {
    SplashScreen: { launchShowDuration: 0, launchAutoHide: true, backgroundColor: "#ffffff", showSpinner: false },
    StatusBar: { style: "LIGHT", backgroundColor: "#ffffff", overlaysWebView: false },
  },
};

export default config;
