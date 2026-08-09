---
title: "Browse: the back button doesn't work — file selection changes state without updating the URL"
workstream: unknown
area: callback-box
filed-by: agent
discovered-in: main session — boxholder using browse/
resolution: implemented
---

**Closed (implemented + boxholder-confirmed) 2026-07-31.** The URL is now the
single source of truth for browse: file selection and the detail-panel back both
route through `onNavigate` (push/replace chosen per action), `?view=` selects the
renderer, and the raw `history.replaceState` that overwrote history entries is
gone. Browser-verified on an isolated router (back steps file→file→dir one entry
at a time; deep links open directly) and boxholder-confirmed. The remaining
human-only checks below moved to their own follow-ups —
[browse-list-live-refresh-not-firing](../../bugs/2026-07-31-browse-list-live-refresh-not-firing.md)
for live refresh; the mobile-back and multi-renderer-toggle checks are minor and
narrow. Reopen only if back/URL sync regresses.

In `browse/`, the browser back button doesn't do the right thing because the URL
doesn't update for enough actions — you click through several files, hit back,
and nothing (or too much) happens, because those clicks never became history
entries.

## Cause

`pages/browse/BrowsePage.tsx` splits navigation between the URL and local state,
inconsistently:

- **URL-backed (back works):** a link followed inside a card calls
  `handleLinkNavigate` → `onNavigate(target.path)` (`:127-129`, `:267`), which
  updates the route splat, so it pushes history.
- **Local-state-only (back does nothing):** selecting a file from the sidebar
  list is `onSelectFile={setSelectedFilePath}` (`:250`) — a plain `useState`
  setter (`:140`), no route change. The detail panel's back button is
  `onBack={() => setSelectedFilePath(null)}` (`:265`) — also local state.

So the *primary* browse action — clicking a file in the list — changes what's
shown without a URL change or a history entry. The code comment at `:148` states
the design intent outright: *"selection can change without nav."* That's the bug
from the user's side: selection-without-nav means the back button has nothing to
step back through, and the URL no longer describes what you're looking at.

The URL model already supports pointing at a file — `initialFile = pathIsFile ?
currentPath : null` (`:136`), and `onNavigate` to a file path works — so the
machinery is there; selection just bypasses it.

## Fix direction

Make the **URL the single source of truth** for what's open in browse, and route
every navigating action through it:

- Selecting a file (`onSelectFile`) should `onNavigate(filePath)` (push history),
  not `setSelectedFilePath`. Then `selectedFilePath` derives from the URL
  (`initialFile`) rather than being independent local state that diverges — the
  `useState` + the `:152` resync effect collapse into "read it from the route."
- The detail-panel back should navigate back to the directory path (a real
  history step / `onNavigate(dirPath)`), not clear local state.
- Decide push-vs-replace per action: stepping between files = **push** (so back
  walks the trail); a pure view-param change (`?view=`) on the same card is
  arguably **replace**. Audit the other browse interactions (view switches,
  detail-panel mode, breadcrumb jumps) for the same "enough actions" gap the
  boxholder named — file selection is the loudest, but "not enough actions" hints
  there are more local-only ones.

## Verify

In a browser: open a directory, click through 3 files, and confirm back steps
through them one at a time (and forward re-does). Then confirm a deep link to a
file still opens it directly, and that the live-refresh (`useBrowseListLiveRefresh`)
still works when the URL, not local state, drives selection. This also fixes the
URL being shareable/bookmarkable to the actual file you're viewing.

## What was actually found and changed (2026-07-31)

The diagnosis above was right but understated one thing: `BrowseSidebarList`
did not merely skip the URL — it wrote the URL with a raw
`window.history.replaceState`, outside the TanStack router. So each file click
OVERWROTE the current history entry (and left router state stale), which is why
back did "nothing or too much" rather than simply nothing.

Changed, all routed through `onNavigate`:

- File selection pushes `/browse/<path>`; `selectedFilePath` derives from the
  route splat (the `useState` and its resync effect are gone).
- The detail panel's back button navigates to the parent directory, and
  REPLACES — pushing meant a browser back reopened the file it just closed.
- A delete replaces too, so back cannot land on the deleted file.
- Link navigation carries the link's `?view=`/params into the URL; a pure view
  change on the file already open replaces instead of pushing.
- `?view=` on a browse URL now actually selects the renderer. It was parsed off
  and dropped before.
- The renderer toggle (the other local-only view switch the "not enough
  actions" complaint pointed at) writes `?view=` instead of `FileView`'s local
  state. `FileView` gained an optional `onSelectRenderer`; when a host provides
  it, the toggle reports upward rather than storing a local choice that
  outranked the `rendererName` prop.

## Verified in a real browser (2026-07-31)

Verifying this required first fixing `bin/browse`, which could not authenticate
against the dev app at all — see
[browse-cannot-authenticate-dev-pages](2026-07-31-browse-cannot-authenticate-dev-pages.md).
Driven against an isolated router (`CALLBACK_STATE_DIR` + `ROUTER_PORT`):

- Clicking two files in `store/recipes` produced a URL per file; browser back
  stepped file 2 → file 1 → the directory → its parent, one entry at a time,
  and forward re-did the trail.
- After a history step the detail panel showed the file the URL named.
- A deep link straight to a card opened it directly.

## What is left for a human

- **Live refresh could not be confirmed** — a card added to the open directory
  did not appear until reload. Filed as
  [browse-list-live-refresh-not-firing](../../bugs/2026-07-31-browse-list-live-refresh-not-firing.md);
  the wiring is byte-identical to before this change for a directory URL, so it
  is probably not this work, but it is unproven either way.
- **The mobile "Back" button** (returns to the list, and a browser back after it
  must NOT reopen the file) — needs a narrow viewport and a real touch device to
  judge.
- **The renderer toggle** writing `?view=<name>`, and that reloading keeps that
  renderer — needs a card type with more than one renderer.

Related: the [iOS new-tab/nav work](2026-07-21-ios-no-new-tab-needs-back-or-overlay.md)
leans on in-app history + back; browse having correct history makes that path
more viable there too.
