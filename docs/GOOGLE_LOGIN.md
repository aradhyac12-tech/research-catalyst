# Google sign-in setup

The app code is done (`src/routes/auth.tsx`). Two dashboards need a one-time setup.

## 1. Google Cloud Console
1. https://console.cloud.google.com/apis/credentials → select or create a project.
2. OAuth consent screen: External, app name "Paperly", your support email. Scopes: `email`, `profile`, `openid`.
   Publish the app (Testing mode only allows the test users you list).
3. Create credentials → OAuth client ID → Web application.
   - Authorized JavaScript origins: your site URL(s), e.g. `https://yourdomain.com` and `http://localhost:3000`
   - Authorized redirect URI (exactly): `https://odrskjcvrjzcscqgjber.supabase.co/auth/v1/callback`
4. Copy the Client ID and Client secret.

## 2. Supabase Dashboard (project: research-catalyst)
1. Authentication → Providers → Google → enable, paste Client ID and Client secret, save.
2. Authentication → URL Configuration:
   - Site URL: your production URL
   - Redirect URLs: add `https://yourdomain.com/**` and `http://localhost:3000/**`

## Notes
- The first account to sign in (Google or email) becomes `super_admin`. Sign in yourself first.
- If the Google button lands on a JSON "provider is not enabled" page, step 2.1 is not done yet.
- If Google shows `redirect_uri_mismatch`, the URI in step 1.3 does not match character for character.
