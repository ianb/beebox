# `baseServerUrl` — server base above the box scope

Strips the trailing box-slug segment from a box's public URL to get the server
base, which callers concatenate with `/auth/...`, `/webhook/...`, etc. It must
**never return a trailing slash** — a caller appending `/auth/google-services/callback`
to a trailing-slash base produced `https://host//auth/...`, which broke Google
OAuth with a redirect_uri mismatch (the double slash).

```ts setup
import { baseServerUrl } from "../../src/webapp/base-server-url.js";
```

## A slug deployment strips the slug, no trailing slash

```ts
baseServerUrl("https://box.example.com/ledger")
=> https://box.example.com
```

## A trailing slash on the input doesn't leak through

```ts
baseServerUrl("https://box.example.com/ledger/")
=> https://box.example.com
```

## A root deployment (no slug) returns the bare origin

This is the case that surfaced the bug: with no slug segment to strip, the old
code left the pathname as `/` and returned `https://host/`.

```ts
baseServerUrl("https://bbx.example.org")
=> https://bbx.example.org

baseServerUrl("https://bbx.example.org/")
=> https://bbx.example.org
```

## The redirect URI a caller builds has exactly one slash

```ts
`${baseServerUrl("https://bbx.example.org")}/auth/google-services/callback`
=> https://bbx.example.org/auth/google-services/callback

`${baseServerUrl("https://box.example.com/ledger")}/auth/google-services/callback`
=> https://box.example.com/auth/google-services/callback
```

## A deployment under a path prefix keeps the prefix (only the slug is stripped)

```ts
baseServerUrl("https://example.com/apps/ledger")
=> https://example.com/apps
```
