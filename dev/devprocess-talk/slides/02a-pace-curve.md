# Commits per month
## Supporting: the pace follows the moves
- Jan 25, Feb 201, Mar 266, Apr 214, May 482, Jun 748, Jul 1,510, Aug 2,305, Sep 2,268, Oct (9 days) 759
- Worktree branches landing on main: May 6, Jun 34, Jul 25, Aug 114, Sep 305
- One git author; 226 active days of 256; no gap over 64 hours after May 9
- Reverts: 13 of 8,778 commits

```text
git log --format='%ad' --date=format:%Y-%m | sort | uniq -c
git log --merges --format='%ad%x09%s' --date=format:%Y-%m | grep "Merge branch 'worktree-" | cut -f1 | sort | uniq -c
```

Notes:
Landings before 2026-08-24 are undercounted: the landing script was fast-forward only until then, so many landings have no merge commit.
