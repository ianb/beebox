# Google Cloud Console Setup

This guide walks through setting up Google OAuth2 credentials for Callback Box. These credentials are shared across all Google connectors (Calendar, Gmail API, Drive).

## 1. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top → **New Project**
3. Name it something like "Callback Box"
4. Click **Create**

## 2. Enable APIs

In your new project, go to **APIs & Services → Library** and enable:

- **Google Calendar API**
- **Gmail API**
- **Google Drive API**
- **Google Sheets API** (required for reading/writing spreadsheet cell values)

Search for each one and click **Enable**.

## 3. Configure OAuth Consent Screen

Go to **APIs & Services → OAuth consent screen**:

1. User type: **External** (even for personal use)
2. App name: "Callback Box" (only you see this)
3. User support email: your email
4. Developer contact: your email
5. Click through the rest — no need to add scopes here (they're requested at auth time)
6. Under **Test users**, add your Google email address
7. Leave the app in **Testing** mode — no need to publish for personal use

> **Note:** In Testing mode, tokens expire every 7 days and you'll need to re-auth. If this becomes annoying, you can publish the app (it won't be listed anywhere since there's no homepage/verification).

## 4. Create OAuth Credentials

Go to **APIs & Services → Credentials**:

1. Click **Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application** (not Desktop)
3. Name: "Callback Box" (or anything)
4. Under **Authorized redirect URIs**, add the URIs for your setup:
   - **Web (recommended):** `https://<your-server>/auth/google-services/callback`
   - **CLI:** `http://localhost:8976/oauth/callback`
5. Click **Create**
6. Copy the **Client ID** and **Client Secret** — set them as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` env vars on the server (these are the same credentials used for app login)

## 5. Authorize Callback Box

Google OAuth tokens are stored centrally (shared across all boxes on the server). Set `CB_GOOGLE_TOKENS_FILE` env var to point to the token file (e.g., `/home/callback/.google-tokens.json`). If not set, tokens fall back to per-box `config/connectors/google.secret.json`.

### Option A: Web Admin (recommended)

1. Go to any box's **Admin** page
2. In the **Google Services** section, click **Connect Google Account**
3. You'll be redirected to Google for authorization
4. After approving, you'll be redirected back — the token is now available to all boxes

### Option B: CLI

```bash
cb google-auth
```

(Client ID/Secret come from env vars `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`.)

### Per-box service policy

After connecting, enable specific services per box in each box's Admin page (Calendar, Gmail, Drive toggles). Or edit `config/box.json` directly:

```json
{
  "googleServices": {
    "calendar": true,
    "gmail": false,
    "drive": false
  }
}
```

If `googleServices` is missing, no Google services are enabled for that box (safe default).

## 6. Verify

```bash
# Pull calendar events
cb wakeup --connector google-calendar

# View today's events
cb calendar today

# View upcoming events (default: next 7 days)
cb calendar
```

## Scopes Authorized

| Scope | Description |
|-------|-------------|
| `calendar.events` | Read and write calendar events |
| `gmail.readonly` | Read all email |
| `gmail.compose` | Create drafts and send email |
| `drive.readonly` | Read all Drive files |
| `drive.file` | Read/write files created by the app |
| `spreadsheets` | Read and write Google Sheets |

## Troubleshooting

### `redirect_uri_mismatch`

The redirect URI in your OAuth client must exactly match the one you're using. For CLI: `http://localhost:8976/oauth/callback`. For web: `https://<your-server>/auth/google-services/callback`. Check for trailing slashes or `https` vs `http`.

### Token expired / invalid_grant

Re-authorize:

```bash
cb google-auth --reauth
```

### Adding more calendars

Edit `config/connectors/google-calendar.json`:

```json
{
  "calendars": ["primary", "your.email@gmail.com", "calendar-id@group.calendar.google.com"],
  "syncDaysBack": 30,
  "syncDaysForward": 90
}
```

Find calendar IDs in Google Calendar → Settings → (calendar name) → "Integrate calendar" section.
