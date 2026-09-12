# Authentication and login-page diagnosis

Dev auth is always on: every TCP request to the router authenticates. `bin/browse` handles this for you by reading `BBX_BROWSE_API_KEY` from this checkout's gitignored `beebox/.env` and seeding it as a cookie in the worktree's isolated Chrome profile. When it works you never think about it.

When you land on `/auth/login`, check these in order before suspecting credentials.

**1. Did you write the box slug into the path?** `open /test1/chats` becomes `/<wt>/test1/test1/chats`, which resolves to no route. You get redirected somewhere plausible rather than an error. Write `open /chats`.

**2. Are you asking for something the key doesn't grant?** The browse key authenticates **box routes** and the **read-only dev surfaces**. It does *not* grant the router's control surfaces:

| path | what authenticates it |
|---|---|
| `/<wt>/<box>/…` | browse key ✅ |
| `/<wt>/dev/…` (GET/HEAD) | browse key ✅ |
| `/workstreams/…` (GET/HEAD) | browse key ✅ |
| `/` (worktree index) | owner session only |
| `/__router/…` (control routes) | owner session only |
| `/workstreams/…` (POST — actions, tRPC mutations) | owner session + same-origin |

The read-only dev grant is enforced by `dev-read` in
`workstreams-app/src/router/router-auth.ts`; control routes intentionally remain
owner-only.

Note `/<wt>/dev/docs/…` is a 301 to `/workstreams/browse?file=…` — the doc browser retired into the general browser. Follow the redirect; both ends accept the key.

A navigation denied at the owner-only rows returns 401, which the router renders as the login page — so "I got the login page" does not by itself mean your key is wrong.

### The key is the owner only on a box that says so

The browse key clears the auth wall. What it *means* inside a box is the box's
call: a box whose `config/box.json` has `"agentBrowsing": "owner"` treats the key
as the box owner — capture, device pairing, Settings, anything behind
`ownerProcedure`, and chat sends attributed to the owner. `test1` sets it, so
every worktree clone and journey box built from it does too. That includes the
Secrets panel (`authenticatedOwnerProcedure`) **on a worktree**, because the
dev router gives each worktree's box its own secret store
(`~/.cache/beebox/secrets/<worktree>.json`); on `main`, whose box is on the
real machine-level store, the panel still refuses the browse identity — no
test box's opt-in reaches the boxholder's real keys.

On a box **without** the field, the
key is nobody: you get **403 "Owner access required"** on owner surfaces and
**401** on capture. That is the fence working, not a key problem. Do not add
the field to such a box to get past it; if a check genuinely needs the owner
there, log in as a person:

```bash
bin/browse auth save owner --url /auth/login --username <email> --password-stdin
bin/browse auth login owner
```

**Ask the boxholder for the credential** — do not invent one, and do not reach for
`bbx auth set-password`, which rewrites a machine-global credential store and revokes
live sessions (`beebox/CLAUDE.md`). If you cannot get one, say which findings
were unreachable rather than reporting them as absent features.

Mechanism: `beebox/docs/plans/agent-browsing-owner.md`.

**3. Is the key live in the running router?** One probe answers it, and it must use the **cookie** form against a **box route**:

```bash
KEY=$(grep '^BBX_BROWSE_API_KEY=' beebox/.env | cut -d= -f2-)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Cookie: bbx_browse_key=$KEY" http://localhost:3210/main/test1/
# 200 → the router has this key. 401 → it doesn't.
```

**Do not probe with `Authorization: Bearer`.** The router's gate accepts the key only as a cookie and returns 401 for a bearer header *even when the key is correct* — so a bearer probe produces a false "the key is rejected" every time. (`core/browse-key.ts` documents both forms because the box wall and hub accept both; the dev router does not.)

**4. Does this worktree's `.env` have the key at all?** The WorktreeCreate hook copies main's `.env` into new worktrees, but worktrees created before that existed don't have it:

```bash
grep -c '^BBX_BROWSE_API_KEY=' beebox/.env    # 0 means that's your problem
grep -v '^BOXES=' ../../beebox/beebox/.env > beebox/.env
```

Copy it **minus `BOXES=`** — that line points at the real boxes, and a worktree that inherits it serves those instead of its own clone.

**5. Only then suspect the value.** The key is machine-wide: one router fronts every worktree, and it loads main's `.env` **at startup**. A worktree with a different key passes its own children and is refused at the router; a key edited after the router started needs a `pnpm dev` restart, which is the boxholder's call — never restart the shared router from a worktree session.

A one-off override without touching any file: `BBX_BROWSE_API_KEY=… bin/browse open /`.

**No key set at all is not an error.** browse proceeds unauthenticated and you land on the login page — which is the honest signal, not a malfunction.
