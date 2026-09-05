# /landing-report — dashboard for parallel-workspace VERSION collisions

Narrow and specific. Worth knowing what it solves, but almost certainly not for us.

## What it does

A read-only dashboard for one specific situation: **gstack workflow users run 5-10 parallel Conductor workspaces at once.** Each workspace is a separate worktree on a separate feature branch, and gstack's `/ship` workflow commits the bumped `VERSION` file ON the feature branch (not at merge time). With several branches in flight simultaneously, two branches can both claim the same version number — e.g. PR #1152 and PR #1153 both committed `1.7.0.0` — and whoever merges second silently overwrites the first's CHANGELOG entry or lands a duplicate.

The skill renders a dashboard:

```
Open PRs claiming versions on <base>:
  #1152  alpha-branch    → v1.7.0.0
  #1153  beta-branch     → v1.7.0.0  ⚠ collision with #1152
  #1151  gamma-branch    → v1.6.5.0

Sibling Conductor worktrees (<workspace_root>):
  ../tokyo-v2     feat/dashboard   v1.7.1.0   3h ago    none  ★ active
  ../melbourne    feat/review      v1.6.0.0   12d ago   none
  ../osaka        feat/payments    v1.8.0.0   5h ago    #1155

★ active = VERSION ahead of base AND last commit < 24h AND no open PR.

If you ran /ship right now, you'd claim:
  micro bump:  v1.6.3.1   (queue-advance: none)
  patch bump:  v1.7.1.0   (bumped past claimed 1.7.0.0)
  minor bump:  v1.8.0.0
  major bump:  v2.0.0.0
```

Then a one-line "next action" suggestion: collision warning, sibling-outranks warning, or "queue is clean."

## Three ideas worth noting

**1. VERSION as a queue-managed shared resource.** Most projects don't bump VERSION on feature branches — the bump happens at merge time, so collisions are impossible. But if you commit VERSION on the feature branch (to capture which version this PR represents for traceability), then VERSION is effectively a shared mutable resource and you need queue awareness. The skill exists because gstack adopted the former approach and inherited the collision problem.

**Lesson:** if a shared resource is mutated on branches (not at merge), expect collisions and build queue awareness.

**2. "Active sibling" heuristic.** `VERSION ahead of base + last commit < 24h + no open PR yet` = "this branch is racing to ship and will probably claim a version soon." Cheap three-signal test for "imminent work that doesn't show up on the PR list yet." Could generalize anywhere you want to detect "in-flight work invisible to the standard tooling."

**3. Show the choice space, not just the answer.** Rather than just telling you "your next ship will be v1.7.1.0," the dashboard shows all four bump levels side-by-side with their resulting version numbers. The user sees the choice and makes it, instead of getting one auto-selected answer. Worth borrowing whenever a skill is about to make a parameterized decision on behalf of the user — show the alternatives, not just the default.

## Verdict for callback

`skip`. Bee Box isn't a multi-workspace parallel-development setup. The collision problem this solves doesn't exist for us. Plus all three sub-projects (beebox, beebox-clerk, cardworks) have independent version streams, not a shared one.

If we ever did adopt parallel workspaces (Conductor or similar), and if we adopted gstack's "commit VERSION on the branch" convention, then queue awareness would matter. Neither is on the horizon.
