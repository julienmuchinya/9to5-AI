# Gmail OAuth Setup — 9to5 AI

Part 2 prepares OAuth validation only. **Do not connect your main personal Gmail** if possible — use a dedicated job-search account.

## 1. Google Cloud project

1. [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **Gmail API**.

## 2. OAuth client

1. APIs & Services → Credentials → Create OAuth client (Web application).
2. Add authorized redirect URI (must match env):

```env
GOOGLE_REDIRECT_URI=https://your-app.vercel.app/api/auth/gmail/callback
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Server-only: never expose `GOOGLE_CLIENT_SECRET` to the browser.

## 3. Connect job-search Gmail

After OAuth flow is implemented (Part 2+), connect only the inbox that receives job alerts.

## 4. Safety rules (Part 2)

- No reading personal mail without job-alert filters
- No outreach emails unless user enables outreach
- No delete / mark-read unless user allows
- No follow-ups in Part 2 unless explicitly enabled later
- Mock mode: **no Gmail API calls**

## 5. Legacy env (optional)

```env
GMAIL_REFRESH_TOKEN=...
```

Used by agent when OAuth refresh token is stored server-side.
