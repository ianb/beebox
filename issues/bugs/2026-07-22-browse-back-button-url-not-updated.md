---
title: "Browse: the back button doesn't work — file selection changes state without updating the URL"
area: callback-box
filed-by: agent
discovered-in: main session — boxholder using browse/
---

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

Related: the [iOS new-tab/nav work](2026-07-21-ios-no-new-tab-needs-back-or-overlay.md)
leans on in-app history + back; browse having correct history makes that path
more viable there too.
