// Where the sign-in session is kept inside the Android app. The phone's own preference store survives the WebView's storage being
// cleared (low storage, "clear cache", an update), so people are not signed out unexpectedly. localStorage still gets a copy, so
// reads stay fast and the session is also restored from it if the preference store is ever empty.
type Store = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };

const local = {
  get: (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del: (k: string) => { try { window.localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

export function nativeAuthStorage(): Store {
  const prefs = () => import("@capacitor/preferences").then((m) => m.Preferences);
  return {
    async getItem(key) {
      try { const { value } = await (await prefs()).get({ key }); if (value != null) return value; } catch { /* fall back to localStorage */ }
      return local.get(key);
    },
    async setItem(key, value) {
      local.set(key, value);
      try { await (await prefs()).set({ key, value }); } catch { /* localStorage already has it */ }
    },
    async removeItem(key) {
      local.del(key);
      try { await (await prefs()).remove({ key }); } catch { /* nothing stored */ }
    },
  };
}
