---
title: "Browse: the back button doesn't work — file selection changes state without updating the URL"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder using browse/
needs: [manual-testing]
---

**Implemented 2026-07-31** on `worktree-browse-back-url` (commits
"browse: make the URL the single source of truth for what's open" and
"browse: put the renderer toggle in the URL, …"), but NOT verified in a
browser — see the "Verification is blocked" section at the bottom.

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

## Verification is blocked

The browser check this issue asks for could not be run: `bin/browse` cannot
authenticate against the local dev app at all. Three separate defects, one now
fixed, two still open — see
[browse-cannot-authenticate-dev-pages](2026-07-31-browse-cannot-authenticate-dev-pages.md).

**What to try by hand, and what should happen.** Open a directory in browse,
click three files in a row, then press browser back three times: it must step
back through them one file at a time (forward re-does the trail). Then check
that a deep link straight to a file still opens it, that the sidebar still
live-updates when a card in the open directory changes, that the mobile "Back"
button returns to the list and a browser back after it does NOT reopen the
file, and that switching the renderer toggle puts `?view=<name>` in the URL and
that reloading the page keeps that renderer.

Related: the [iOS new-tab/nav work](2026-07-21-ios-no-new-tab-needs-back-or-overlay.md)
leans on in-app history + back; browse having correct history makes that path
more viable there too.
