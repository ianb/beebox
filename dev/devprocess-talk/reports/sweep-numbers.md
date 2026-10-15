# Repo numbers and timeline (dev-process talk)

Collected 2026-10-09 at HEAD e9ba5c2c8 (branch worktree-devprocess-talk, clean, = main at that time). All commands run from the repo root. Three helper scripts (numbers-collect, size-snapshots, caught) produced the derived tables in sections 3, 6c and 13; they were session scratch and are not committed, but each table names the git command it is derived from.

Caveats that apply throughout:
- The repo is a monorepo assembled on 2026-05-26 from five prior repos whose histories were merged in (section 2). Commit counts before 2026-05-26 are the sum of those histories; <old-package> is ~90% of them.
- Bee Box was named the former product name until 2026-08-30 (`dab834811 feat!: rename the former product name to Bee Box`). Path-based counts for `beebox/` start then; the same code lived at `<old-package>/` before.
- There is one git author (Ian Bicking). Agent involvement is visible only through the `Co-Authored-By` trailer, and from 2026-06-18 the `Claude-Session` trailer.

## 1. Timeline

```sh
git log --reverse --format='%h %ad %s' --date=short | head -1
```
```
feb42fed4 2026-01-27 first commit
```

```sh
git rev-list --count HEAD
```
```
8778
```

```sh
git log --format='%ad' --date=format:%Y-%m | sort | uniq -c
```
```
  25 2026-01
 201 2026-02
 266 2026-03
 214 2026-04
 482 2026-05
 748 2026-06
1510 2026-07
2305 2026-08
2268 2026-09
 759 2026-10
```

```sh
git log --first-parent --format='%ad' --date=format:%Y-%m | sort | uniq -c   # main-line only (merge = 1)
```
```
 152 2026-05
 332 2026-06
 473 2026-07
 693 2026-08
 625 2026-09
 189 2026-10
```

```sh
git log --since=2026-07-17 --format='%ad' --date=format:%G-W%V | sort | uniq -c   # last 12 weeks (ISO week)
```
```
 146 2026-W29
 244 2026-W30
 422 2026-W31
 546 2026-W32
 366 2026-W33
 390 2026-W34
 814 2026-W35
 467 2026-W36
 541 2026-W37
 538 2026-W38
 597 2026-W39
 250 2026-W40
 662 2026-W41
```

```sh
git log --merges --format='%ad' --date=format:%Y-%m | sort | uniq -c
```
```
  38 2026-05
 124 2026-06
 170 2026-07
 509 2026-08
 660 2026-09
 244 2026-10
```

```sh
git log --merges --format='%ad%x09%s' --date=format:%Y-%m | grep -E "Merge branch '?worktree-" | cut -f1 | sort | uniq -c
```
```
   6 2026-05
  34 2026-06
  25 2026-07
 114 2026-08
 305 2026-09
 116 2026-10
```

```sh
git log --merges --format='%s' | grep -oE "Merge branch '?worktree-[^' ]+" | sort -u | wc -l   # distinct worktree branches ever merged
```
```
     222
```

```sh
git log --format='%an' | sort | uniq -c
```
```
8778 Ian Bicking
```

**Co-Authored-By trailer values** (count, first date, last date)

```sh
git log --format='%ad%x09%(trailers:key=Co-Authored-By,valueonly,separator=%x7C)' --date=short   # then grouped per value in python
```

| value | commits | first | last |
|---|---|---|---|
| Claude Opus 4.5 | 56 | 2026-01-28 | 2026-02-03 |
| Claude Opus 4.6 | 308 | 2026-02-06 | 2026-03-15 |
| OpenAI Codex | 1 | 2026-03-06 | 2026-03-06 |
| Claude Opus 4.6 (1M context) | 185 | 2026-03-15 | 2026-04-16 |
| Claude Opus 4.7 (1M context) | 200 | 2026-04-16 | 2026-06-04 |
| Claude Opus 4.7 | 212 | 2026-04-21 | 2026-05-28 |
| Claude Haiku 4.5 | 3 | 2026-04-21 | 2026-04-21 |
| Claude Sonnet 4.6 | 13 | 2026-05-11 | 2026-06-08 |
| Claude Opus 4.8 (1M context) | 878 | 2026-05-29 | 2026-08-08 |
| Claude Fable 5 | 1532 | 2026-06-09 | 2026-09-05 |
| Claude Sonnet 5 | 107 | 2026-07-07 | 2026-09-27 |
| Claude Opus 4.8 | 42 | 2026-07-15 | 2026-08-08 |
| Claude Opus 5 (1M context) | 411 | 2026-07-28 | 2026-09-21 |
| Claude Opus 5 | 629 | 2026-07-28 | 2026-09-21 |
| Claude Fable 5.1 | 516 | 2026-09-02 | 2026-10-08 |
| Claude Code | 13 | 2026-09-15 | 2026-10-02 |
| Claude Opus 5.5 | 434 | 2026-09-22 | 2026-10-08 |
| Claude Opus 5.5 (1M context) | 143 | 2026-09-23 | 2026-10-08 |
| Claude Sonnet 5.5 | 47 | 2026-09-29 | 2026-10-08 |

**Co-author model family per month**

Same command as above, bucketed by family.

| month | Opus | Fable | Sonnet | Haiku | Codex | Claude Code (unversioned) | (no co-author) |
|---|---|---|---|---|---|---|---|
| 2026-01 | 23 | 0 | 0 | 0 | 0 | 0 | 2 |
| 2026-02 | 192 | 0 | 0 | 0 | 0 | 0 | 9 |
| 2026-03 | 263 | 0 | 0 | 0 | 1 | 0 | 3 |
| 2026-04 | 198 | 0 | 0 | 3 | 0 | 0 | 13 |
| 2026-05 | 327 | 0 | 11 | 0 | 0 | 0 | 144 |
| 2026-06 | 499 | 115 | 2 | 0 | 0 | 0 | 132 |
| 2026-07 | 377 | 782 | 3 | 0 | 0 | 0 | 348 |
| 2026-08 | 587 | 573 | 5 | 0 | 0 | 0 | 1140 |
| 2026-09 | 675 | 506 | 102 | 0 | 0 | 9 | 976 |
| 2026-10 | 357 | 72 | 44 | 0 | 0 | 4 | 284 |
| total | 3498 | 2048 | 167 | 3 | 1 | 13 | 3051 |

**Commits carrying each provenance trailer, per month**

```sh
git log --format='%ad%x09%(trailers:key=Claude-Session,valueonly,separator=%x7C)%x09%(trailers:key=Workstream,valueonly,separator=%x7C)%x09%(trailers:key=Plan,valueonly,separator=%x7C)%x09%(trailers:key=Issue,valueonly,separator=%x7C)%x09%(trailers:key=Contract-Unchanged,valueonly,separator=%x7C)' --date=short
```
First dates: Claude-Session 2026-06-18, Workstream 2026-08-24, Plan 2026-08-24, Issue 2026-08-24, Contract-Unchanged 2026-07-17

| month | Claude-Session | Workstream | Plan | Issue | Contract-Unchanged |
|---|---|---|---|---|---|
| 2026-01 | 0 | 0 | 0 | 0 | 0 |
| 2026-02 | 0 | 0 | 0 | 0 | 0 |
| 2026-03 | 0 | 0 | 0 | 0 | 0 |
| 2026-04 | 0 | 0 | 0 | 0 | 0 |
| 2026-05 | 0 | 0 | 0 | 0 | 0 |
| 2026-06 | 45 | 0 | 0 | 0 | 0 |
| 2026-07 | 543 | 0 | 0 | 0 | 16 |
| 2026-08 | 916 | 399 | 140 | 149 | 23 |
| 2026-09 | 1135 | 1406 | 728 | 136 | 38 |
| 2026-10 | 400 | 483 | 112 | 73 | 13 |
| total | 3039 | 2288 | 980 | 358 | 90 |

```sh
git log --format='%(trailers:key=Workstream,valueonly)' | sed '/^$/d' | sort -u | wc -l   # distinct workstream names
```
```
     180
```

## 2. Monorepo merge (2026-05-26)

```sh
git rev-list --max-parents=0 HEAD | xargs -n1 git log -1 --format='%h %ad %s' --date=short
```
```
ffe43bb1b 2026-05-26 Initial commit
1739e4c9e 2026-03-09 Initial extraction of agent-doctest from <old-package>
893ad26ff 2026-02-13 Initial package setup
4f934e974 2026-02-07 first commit
5a57399ee 2026-01-29 first commit
feb42fed4 2026-01-27 first commit
```

```sh
git log --format='%h %ad %p | %s' --date=iso --since=2026-05-26 --until=2026-05-27 | grep -E 'Import|Initial commit'
```
```
243444413 2026-05-26 12:27:39 -0500 0d81cbd33 | Import personal-vibe-check into the monorepo; update file: dep paths
0d81cbd33 2026-05-26 12:26:05 -0500 a6ccdd4ad ac96d6eee | Import personal-vibe-check history into monorepo
9c5411149 2026-05-26 10:29:47 -0500 9c3ff625b | Import remaining files from ~/src/callback
9c3ff625b 2026-05-26 10:29:32 -0500 d8bf39507 bf0ca3d50 | Import agent-doctest history
d8bf39507 2026-05-26 10:29:32 -0500 762d73d77 561db8bbb | Import cardworks history
762d73d77 2026-05-26 10:29:31 -0500 9bd400229 c3a21f8f3 | Import <old-clerk-package> history
9bd400229 2026-05-26 10:29:31 -0500 ffe43bb1b 237a99f02 | Import <old-package> history
ffe43bb1b 2026-05-26 10:29:30 -0500  | Initial commit
```

Imported histories (second parent of each Import merge):

| import commit | source repo | source commits | source root date | source tip date |
|---|---|---|---|---|
| 9bd400229 | <old-package> (became beebox) | 874 | 2026-01-29 | 2026-05-25 |
| 762d73d77 | <old-clerk-package> (became beebox-clerk) | 15 | 2026-02-07 | 2026-03-06 |
| d8bf39507 | cardworks | 44 | 2026-01-27 | 2026-05-23 |
| 9c3ff625b | agent-doctest | 9 | 2026-03-09 | 2026-03-25 |
| 0d81cbd33 | personal-vibe-check | 25 | 2026-02-13 | 2026-05-14 |

Per row: `git rev-list --count <mc>^2`, `git log --reverse --format=%ad --date=short <mc>^2 | head -1`, `git log -1 --format=%ad --date=short <mc>^2`.

```sh
git log --reverse --format='%h %ad %s' --date=short --since=2026-05-26 --until=2026-06-10 | grep -iE 'monorepo|rename|callback|beebox' | head -15
```
```
9bd400229 2026-05-26 Import <old-package> history
762d73d77 2026-05-26 Import <old-clerk-package> history
9c5411149 2026-05-26 Import remaining files from ~/src/callback
7976ef2bc 2026-05-26 Monorepo housekeeping: gitignore runtime crud, update layout docs
7e26a35b8 2026-05-26 Doc sweep: remaining npm -> pnpm in <old-package>/docs/
8e788ca6d 2026-05-26 <old-clerk-package>: document the broken callback-dropbox dep
10d30cefd 2026-05-26 worktree-create hook: build cardworks before <old-package> install
367da6de7 2026-05-26 <old-package>: pnpm.onlyBuiltDependencies for native modules
0d81cbd33 2026-05-26 Import personal-vibe-check history into monorepo
243444413 2026-05-26 Import personal-vibe-check into the monorepo; update file: dep paths
085a23011 2026-05-26 Hoist husky to monorepo root; recover hooks broken by migration
0d863d832 2026-05-26 frontend: fix personal-vibe-check path (4-up -> 3-up) post-monorepo
ced87b55b 2026-05-26 Stop using npm anywhere in the monorepo
73710ed59 2026-05-26 Stub eslint configs for monorepo-root dirs (bin, feedback-review)
e41bf1059 2026-05-27 router: pin /main/ to ~/src/<old-monorepo-dir> (override via <old-root-env-var>)
```

```sh
git log --reverse --format='%h %ad %s' --date=short | grep -iE 'rename.*(callback|beebox)|<old-package>.*beebox|beebox.*callback' | head -8
```
```
dab834811 2026-08-30 feat!: rename the former product name to Bee Box
```

## 3. Size over time

`dev/project-size/data/history/` has only two snapshots (2026-09-28, 2026-10-04), so monthly sizes were recomputed from git objects by `size-snapshots.py` (`git ls-tree -r <sha>` + `git cat-file --batch`, non-blank lines, binary and lockfiles excluded). Before 2026-05-27 each row sums the five pre-monorepo histories at their last first-parent commit before the date; after, it is `git rev-list -1 --first-parent --before=<date> HEAD`. Classification is a simplified copy of `bin/project-size.ts` (tests = `*.doctest.md`, `*.test.ts(x)`, files under test/tests/__tests__/fixtures dirs; docs split by path), so HEAD numbers differ by a few percent from the official report.

```sh
python3 -I size-snapshots.py
```

| snapshot | total files | code lines | doctest files | doctest lines | *.test.ts files | *.test.ts lines | other test lines | docs:plans lines | docs:issues lines | docs:agent lines | docs:research lines | docs:other lines |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-02-01 | 136 | 11,858 | 0 | 0 | 11 | 2,229 | 21 | 0 | 0 | 150 | 0 | 3,417 |
| 2026-03-01 | 406 | 45,857 | 0 | 0 | 16 | 3,161 | 59 | 0 | 0 | 146 | 0 | 7,312 |
| 2026-04-01 | 685 | 63,110 | 59 | 8,229 | 16 | 3,613 | 711 | 0 | 0 | 281 | 0 | 12,388 |
| 2026-05-01 | 839 | 79,145 | 79 | 12,339 | 16 | 3,642 | 1,278 | 0 | 0 | 349 | 0 | 13,375 |
| 2026-06-01 | 1,220 | 100,642 | 97 | 13,740 | 17 | 3,805 | 2,086 | 0 | 0 | 1,349 | 0 | 22,945 |
| 2026-07-01 | 1,564 | 119,370 | 182 | 23,597 | 9 | 1,573 | 2,122 | 17,852 | 0 | 3,594 | 0 | 22,745 |
| 2026-08-01 | 3,003 | 205,556 | 413 | 55,191 | 49 | 6,420 | 3,996 | 49,339 | 14,345 | 4,965 | 11,752 | 17,555 |
| 2026-09-01 | 4,735 | 309,317 | 712 | 102,990 | 98 | 13,697 | 5,062 | 72,849 | 39,319 | 5,860 | 14,909 | 33,659 |
| 2026-10-01 | 6,446 | 378,748 | 1,022 | 145,672 | 133 | 18,689 | 12,755 | 109,865 | 58,934 | 5,163 | 15,088 | 44,795 |
| HEAD | 6,779 | 390,172 | 1,035 | 141,454 | 142 | 19,198 | 14,831 | 113,052 | 64,630 | 4,085 | 16,876 | 47,276 |

| snapshot | open plans | implemented plans | skills | CLAUDE.md files | CLAUDE.md lines | open issues | closed issues | schedules |
|---|---|---|---|---|---|---|---|---|
| 2026-02-01 | 0 | 0 | 0 | 1 | 150 | 0 | 0 | 0 |
| 2026-03-01 | 0 | 0 | 0 | 5 | 264 | 0 | 0 | 0 |
| 2026-04-01 | 0 | 0 | 0 | 11 | 399 | 0 | 0 | 0 |
| 2026-05-01 | 0 | 0 | 0 | 12 | 467 | 0 | 0 | 0 |
| 2026-06-01 | 0 | 0 | 4 | 14 | 551 | 0 | 0 | 0 |
| 2026-07-01 | 18 | 34 | 11 | 13 | 577 | 0 | 0 | 0 |
| 2026-08-01 | 28 | 99 | 16 | 18 | 1308 | 218 | 113 | 0 |
| 2026-09-01 | 59 | 145 | 23 | 18 | 2322 | 343 | 404 | 9 |
| 2026-10-01 | 89 | 214 | 24 | 19 | 1686 | 453 | 613 | 13 |
| HEAD | 88 | 225 | 21 | 20 | 1813 | 468 | 717 | 15 |

Snapshot commits: 2026-02-01: 37caf04eb,204c600d4; 2026-03-01: d6a0ea053,f2ad35472,cfc9f25be,9a19fb5ad; 2026-04-01: ed15356a4,c3a21f8f3,d212712ab,bf0ca3d50,efabcf79f; 2026-05-01: be0fa33f8,c3a21f8f3,134f14a1f,bf0ca3d50,e35182196; 2026-06-01: e90faece8; 2026-07-01: 7c8c18e15; 2026-08-01: d92902753; 2026-09-01: fbd578eca; 2026-10-01: b5a09f133; HEAD: e9ba5c2c8

Official latest snapshot for comparison (bin/project-size.ts classification):

```sh
python3 -c "import json;print(json.load(open('dev/project-size/data/latest.json'))['values'])"
```
```
collectedAt 2026-10-04, commit 1a9815f08: files 6456, lines 837812, code 377516 (2860 files), tests 176072 (1413 files), docs 235647,
doctest 146565 lines / 1034 files (83% of test lines; 118778 fenced code, 27787 prose), *.test.ts 18251 lines / 132 files,
tests code-only = 39% of code lines, beebox = 69% of all lines
```

byCategory at 2026-10-04 (non-blank lines): code 377,516; tests 176,072; docs: plans & reports 113,123; docs: issues 59,767; docs: guides & other 42,476; config & data 33,248; docs: research 15,386; lockfiles 15,329; docs: agent instructions 4,895 (63 files).

## 4. Commits touching each directory, per month

**Commits per directory**

`git log --format='%ad' --date=format:%Y-%m -- <dir> | sort | uniq -c` per dir. Note: pre-2026-05-26 beebox lived at <old-package>/ in an imported history, so beebox/ counts before June are path-limited (see next table).

| month | beebox/ | bin/ | workstreams-app/ | issues/ | .claude/ | schedules/ | dev/ | beebox/docs/plans/ |
|---|---|---|---|---|---|---|---|---|
| 2026-01 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-02 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-03 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-04 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 2026-05 | 0 | 30 | 0 | 0 | 36 | 0 | 0 | 0 |
| 2026-06 | 0 | 17 | 0 | 0 | 28 | 0 | 1 | 0 |
| 2026-07 | 0 | 86 | 0 | 467 | 40 | 0 | 24 | 0 |
| 2026-08 | 30 | 274 | 63 | 1068 | 126 | 25 | 14 | 7 |
| 2026-09 | 1315 | 112 | 55 | 791 | 69 | 51 | 7 | 300 |
| 2026-10 | 400 | 35 | 9 | 304 | 32 | 25 | 3 | 49 |
| total | 1745 | 554 | 127 | 2630 | 331 | 101 | 49 | 356 |

**Pre-rename paths**

`git log --format='%ad' --date=format:%Y-%m -- <dir>`

| month | <old-package>/ | <old-package>/docs/plans/ | <old-package>/issues/ |
|---|---|---|---|
| 2026-01 | 6 | 0 | 0 |
| 2026-02 | 161 | 0 | 0 |
| 2026-03 | 248 | 0 | 0 |
| 2026-04 | 207 | 0 | 0 |
| 2026-05 | 408 | 0 | 0 |
| 2026-06 | 685 | 108 | 0 |
| 2026-07 | 1089 | 231 | 0 |
| 2026-08 | 1213 | 250 | 0 |
| 2026-09 | 0 | 0 | 0 |
| 2026-10 | 0 | 0 | 0 |
| total | 4017 | 589 | 0 |

## 5. Subject keyword counts per month (case-insensitive, subject line only)

**Keyword × month**

```sh
git log --format='%ad%x09%s' --date=format:%Y-%m
```
A subject counts once per keyword if it contains the lowercase keyword as a substring (so 'plan' also matches 'plans', 'planner'; 'issue' matches 'issues'). Spot-check one cell: `git log --format=%s --since=2026-08-01 --until=2026-09-01 | grep -ic doctest`.

| month | worktree | workstream | issue | plan | skill | doctest | lint | schedule | cross-model | codex | audit | journey | tour | finish | exhibit | comment |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-01 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| 2026-02 | 0 | 0 | 2 | 0 | 0 | 0 | 17 | 4 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 4 |
| 2026-03 | 0 | 0 | 2 | 0 | 0 | 13 | 3 | 9 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 |
| 2026-04 | 0 | 0 | 0 | 4 | 0 | 2 | 0 | 6 | 0 | 0 | 2 | 0 | 0 | 2 | 0 | 0 |
| 2026-05 | 61 | 0 | 0 | 11 | 8 | 4 | 29 | 2 | 0 | 0 | 11 | 0 | 6 | 4 | 0 | 5 |
| 2026-06 | 128 | 0 | 0 | 110 | 22 | 12 | 15 | 13 | 1 | 21 | 28 | 0 | 0 | 3 | 0 | 46 |
| 2026-07 | 197 | 0 | 264 | 236 | 20 | 13 | 35 | 16 | 8 | 76 | 52 | 0 | 4 | 18 | 0 | 6 |
| 2026-08 | 551 | 212 | 570 | 247 | 35 | 39 | 21 | 69 | 62 | 130 | 12 | 20 | 18 | 38 | 23 | 12 |
| 2026-09 | 663 | 256 | 326 | 322 | 13 | 28 | 25 | 48 | 36 | 42 | 31 | 9 | 8 | 15 | 0 | 8 |
| 2026-10 | 243 | 88 | 141 | 50 | 40 | 32 | 7 | 25 | 12 | 19 | 16 | 12 | 5 | 3 | 1 | 1 |
| total | 1843 | 556 | 1305 | 980 | 138 | 143 | 153 | 192 | 119 | 288 | 168 | 41 | 41 | 83 | 24 | 84 |

## 6. Issues

```sh
git ls-files 'issues/*.md' | grep -v '^issues/closed/' | grep -vE '(^|/)(CLAUDE|AGENTS|README)\.md$' | wc -l   # open
```
```
     467
```

```sh
git ls-files 'issues/closed/*.md' | wc -l   # closed
```
```
     717
```

```sh
git ls-files 'issues/*.md' | grep -v '^issues/closed/' | awk -F/ '{print $2}' | sort | uniq -c | sort -rn   # open by category
```
```
 166 features
 108 bugs
  77 exploration
  52 code-quality
  29 docs-and-chores
  26 decisions
   7 watch
   2 deferred
   1 CLAUDE.md
```

```sh
git log --reverse --format='%h %ad %s' --date=short -- issues/ | head -1   # issues/ began
```
```
2c6c497c2 2026-07-04 feat: replace ideas.md with issues/ — one file per idea, in-tree tracking
```

```sh
git ls-files 'issues/*.md' | grep -oE '/20[0-9]{2}-[0-9]{2}-[0-9]{2}-' | cut -c2-8 | sort | uniq -c   # filed per month (date prefix in filename, open+closed)
```
```
  22 2026-03
   2 2026-04
  56 2026-05
  24 2026-06
 227 2026-07
 430 2026-08
 314 2026-09
 109 2026-10
```

**Closed per month** (earliest date each basename first appears under issues/closed/)

```sh
git log --no-renames --diff-filter=A --name-only --format='@%ad' --date=short -- issues/closed/   # earliest date per basename, bucketed by month
```

| month | closed |
|---|---|
| 2026-01 | 0 |
| 2026-02 | 0 |
| 2026-03 | 0 |
| 2026-04 | 0 |
| 2026-05 | 0 |
| 2026-06 | 0 |
| 2026-07 | 112 |
| 2026-08 | 298 |
| 2026-09 | 208 |
| 2026-10 | 103 |
| total distinct | 721 |

```sh
grep -h '^resolution:' -r issues/closed | sort | uniq -c | sort -rn
```
```
 623 resolution: implemented
  53 resolution: wontfix
  41 resolution: superseded
```

```sh
grep -h '^discovered-by:' -r issues | sed 's/discovered-by: *//' | sort | uniq -c | sort -rn | head -5
```
```
 326 agent
 311 Ian
   3 a box agent, in its report on a first real run (box name withheld)
   1 cross-model review
   1 boxholder
```

```sh
grep -h '^filed-by:' -r issues | sed 's/filed-by: *//' | sort | uniq -c | sort -rn | head -5
```
```
 996 agent
```

## 7-10. Plans, tests, skills, schedules (current counts and first-add per month)

```sh
git ls-files 'beebox/docs/plans/*' | wc -l; git ls-files 'beebox/docs/plans/*.md' | grep -v '/.*/.*/.*/.*/' | wc -l   # all files; top-level .md
```
```
      88
      88
```

```sh
git ls-files 'beebox/docs/plans/' | awk -F/ 'NF>4{print $4}' | sort -u | wc -l   # subdirectories
```
```
       0
```

```sh
git ls-files 'beebox/docs/implemented-plans/*.md' | wc -l   # implemented plans
```
```
     214
```

```sh
git ls-files '*.doctest.md' | wc -l; git ls-files '*.test.ts' '*.test.tsx' | wc -l
```
```
    1035
     142
```

```sh
git ls-files '.claude/skills/*/SKILL.md' | wc -l; ls -d .claude/skills/*/ | wc -l
```
```
      21
      21
```

```sh
ls schedules | wc -l; git ls-files 'schedules/*' | wc -l
```
```
      15
      87
```

**First appearance per month (distinct logical file; <old-package>/ and beebox/ prefixes folded so the rename does not double count)**

```sh
git log --no-renames --diff-filter=A --name-only --format='@%ad' --date=short -- '*docs/plans/*.md'
git log --no-renames --diff-filter=A --name-only --format='@%ad' --date=short -- '*.doctest.md'
git log --no-renames --diff-filter=A --name-only --format='@%ad' --date=short -- '*.test.ts' '*.test.tsx'
git log --no-renames --diff-filter=A --name-only --format='@%ad' --date=short -- '*.claude/skills/*/SKILL.md'
```
Keyed by basename (plans), path minus package prefix (tests), skill dir name (skills). Totals include files since deleted or renamed, so they exceed current counts.

| month | plans (any docs/plans/*.md incl. <old-package>/) | doctests | *.test.ts(x) | skills |
|---|---|---|---|---|
| 2026-01 | 0 | 0 | 11 | 0 |
| 2026-02 | 0 | 0 | 5 | 0 |
| 2026-03 | 0 | 62 | 10 | 0 |
| 2026-04 | 0 | 22 | 0 | 0 |
| 2026-05 | 0 | 35 | 1 | 4 |
| 2026-06 | 30 | 235 | 5 | 7 |
| 2026-07 | 73 | 241 | 54 | 5 |
| 2026-08 | 59 | 310 | 72 | 25 |
| 2026-09 | 68 | 1106 | 100 | 1 |
| 2026-10 | 4 | 74 | 10 | 3 |
| total | 234 | 2085 | 268 | 45 |

**Schedules: first commit of each**

```sh
for d in schedules/*/; do echo "$(git log --reverse --format=%ad --date=short -- $d | head -1) $d"; done | sort
```
```
2026-08-24 schedules/docling-update/
2026-08-24 schedules/knip-sweep/
2026-08-24 schedules/manual-tests/
2026-08-24 schedules/sdk-update/
2026-08-25 schedules/full-suite/
2026-08-26 schedules/smoke-review/
2026-08-26 schedules/tour-check/
2026-08-29 schedules/supplemental-lint/
2026-08-31 schedules/deferred-issues/
2026-09-04 schedules/cross-box-leak-scan/
2026-09-12 schedules/box-convergence/
2026-09-16 schedules/agent-docs-refresh/
2026-09-18 schedules/alert-filing/
2026-10-02 schedules/disk-hygiene/
2026-10-07 schedules/retrospective/
```

## 11. CLAUDE.md files

```sh
git ls-files '*CLAUDE.md' | wc -l; git ls-files '*CLAUDE.md' | xargs cat | wc -l
```
```
      20
    2284
```

```sh
git ls-files '*CLAUDE.md' | xargs wc -l | sort -rn | head -12
```
```
    2284 total
     303 issues/CLAUDE.md
     284 site/CLAUDE.md
     261 bin/CLAUDE.md
     241 ios-app/CLAUDE.md
     168 beebox/src/frontend/src/components/chat/CLAUDE.md
     137 beebox-clerk/CLAUDE.md
     110 beebox/src/services/CLAUDE.md
      98 scan-uploader/CLAUDE.md
      89 personal-vibe-check/CLAUDE.md
      86 feedback-review/CLAUDE.md
      73 CLAUDE.md
```

```sh
git ls-files '*AGENTS.md' '.claude/agents/*' | wc -l
```
```
       1
```

**beebox/CLAUDE.md (and its predecessor <old-package>/CLAUDE.md) line count at each commit**

```sh
git log --follow --format='%h %ad' --date=short -- beebox/CLAUDE.md
# per sha: git show <sha>:<path> | wc -l  (path = beebox/CLAUDE.md or <old-package>/CLAUDE.md, whichever exists)
```

110 commits. Full series (date sha lines):

```
2026-01-30 e5cc933ad 217
2026-01-31 0ae6c8d3d 219
2026-02-07 3b45817f6 220
2026-02-17 a143179ad 222
2026-02-19 bc026cd53 222
2026-02-21 507962a74 209
2026-02-23 f11a9199f 209
2026-03-03 6aaefdebe 218
2026-03-03 66a45f868 118
2026-03-03 55a8b97e7 122
2026-03-03 2521dea5e 141
2026-03-04 1a45afb09 145
2026-03-06 bedf968cf 114
2026-03-07 d29be33de 116
2026-03-08 49a7adf38 118
2026-03-09 e3f9be6a0 119
2026-03-10 7d08cad13 121
2026-04-17 c55d49827 127
2026-04-17 00f05941a 130
2026-04-17 54a044535 131
2026-04-18 5bee6b5ed 132
2026-04-18 ed292cb12 133
2026-04-26 b75ff0269 134
2026-04-27 68247a544 135
2026-05-05 d6434b37e 121
2026-05-09 178931c5e 122
2026-05-14 78e5a5da7 121
2026-05-21 dbfc2335e 122
2026-05-21 3f328bd88 123
2026-05-23 cf1a5f340 136
2026-05-23 06eea48c6 141
2026-05-23 972c240f5 141
2026-05-25 a51fec60b 141
2026-05-26 7976ef2bc 141
2026-05-26 308abbfc4 141
2026-05-26 43fc5762e 141
2026-05-26 f5e5d6e8e 141
2026-05-26 96932b6df 146
2026-05-27 05ca9ba1f 146
2026-05-29 5e8015be9 146
2026-06-04 166638551 146
2026-06-08 050ec47d9 146
2026-06-18 fc33a9620 146
2026-06-18 48f434577 146
2026-06-18 5c39d71f2 146
2026-06-18 bcb3fd6f9 146
2026-06-18 c8aaa6d77 146
2026-06-19 1130a7fed 144
2026-06-20 7578fff51 144
2026-06-21 eb900f164 145
2026-06-21 14c25ea14 144
2026-06-28 889159bd5 145
2026-06-29 de7aa57b4 145
2026-06-30 93fc76d69 146
2026-07-01 c1ed4d353 146
2026-07-02 c5f700a2a 147
2026-07-02 939a0d2b7 146
2026-07-03 2f192053e 148
2026-07-04 6fd2a172b 149
2026-07-04 7b9646c98 149
2026-07-04 4b1f3ba70 158
2026-07-04 eef3b77a6 148
2026-07-04 6af01c69a 148
2026-07-04 c90559bf3 148
2026-07-04 afac6cdf1 147
2026-07-04 0e4b83fc2 148
2026-07-04 2c6c497c2 149
2026-07-05 10ef0ae7c 149
2026-07-06 bba09bbd0 150
2026-07-06 cc94b4c28 151
2026-07-06 2c8cf14cc 165
2026-07-10 88bb0526c 168
2026-07-10 fa6e07500 166
2026-07-11 7a7d811d0 169
2026-07-12 3d81af6db 170
2026-07-12 727b578c2 171
2026-07-12 982bbd172 172
2026-07-17 cae733c69 174
2026-07-21 be8dda2cd 175
2026-07-21 7cf6a9c53 175
2026-07-28 9ba0f53d0 176
2026-07-30 52bcd3987 177
2026-07-30 6d1fd93a3 177
2026-07-30 92a92e040 177
2026-08-01 0ee5b6e85 177
2026-08-01 167cede34 179
2026-08-03 cdb3fb8a2 180
2026-08-06 3bac0d66c 180
2026-08-14 00f8e75d9 180
2026-08-17 4942d9be4 181
2026-08-19 dfbdf2008 181
2026-08-25 f317b29bb 181
2026-08-25 6e565471b 181
2026-08-25 89a5fb669 182
2026-08-26 30294ee3e 182
2026-08-30 dab834811 183
2026-09-04 c165a42fa 183
2026-09-05 d8785ba69 184
2026-09-12 0bb2ece90 184
2026-09-12 d7b47dfde 67
2026-09-16 741dca4cb 67
2026-09-16 13ab4dbb6 69
2026-09-25 12a0f87ef 69
2026-09-25 2f687a63e 69
2026-09-25 fb6a9e18a 69
2026-09-27 881eb9dab 69
2026-10-07 89561e075 69
2026-10-07 bd85ee4a1 69
2026-10-07 6cd8fb1f6 71
2026-10-08 81c647230 71
```

Peak: 222 lines on 2026-02-17 (a143179ad). Latest: 71 lines on 2026-10-08. The largest single cut was 184 → 67 lines on 2026-09-12 (d7b47dfde "Route operational guidance and scope coding workflows", agent-docs workstream). Total CLAUDE.md lines across the repo (non-blank, section 3 table) peaked at 2,322 on 2026-09-01 and were 1,813 at HEAD.

Note on section 7-10 first-appearance table: the doctest spike in 2026-09 (1106) is mostly the 2026-09-27 "Layout moves" commits re-adding files under new paths; use the monthly net counts in section 3 (doctest files 59 → 79 → 97 → 182 → 413 → 712 → 1022 → 1035) for growth. Plans by basename and skills by directory name are not affected.

## 6b. Issue discovery source and resolution (developer addition)

There is no `resolved-by:` frontmatter field in any issue (`grep -l '^resolved-by:' -r issues | wc -l` → 0). Closed issues carry `resolution:` (section 6); the commit-side link is the `Issue:` trailer (section 1, per month: Aug 149, Sep 136, Oct 73; first used 2026-08-24). Closed-per-month is in section 6.

Issues whose `discovered-in:` mentions each source (case-insensitive substring; one issue can match several rows; free-text field, so these are lower bounds):

```sh
for src in 'schedul|weekly|nightly|hourly|daily' 'cross-model|codex' 'review' 'audit' 'walk|journey' 'tour' 'smoke' 'full[- ]suite' 'lint|knip' 'retro' 'feedback triage|bbx feedback' 'boxholder'; do
  o=$(grep -l -i -E "^discovered-in:.*($src)" -r issues --include='*.md' | grep -v '^issues/closed/' | wc -l)
  c=$(grep -l -i -E "^discovered-in:.*($src)" -r issues/closed | wc -l); echo "$src $o $c"; done
```

| discovered-in pattern | open | closed |
|---|---|---|
| schedul\|weekly\|nightly\|hourly\|daily | 11 | 32 |
| cross-model\|codex | 13 | 40 |
| review (any, includes cross-model) | 47 | 82 |
| audit | 5 | 5 |
| walk\|journey | 43 | 39 |
| tour | 3 | 6 |
| smoke | 3 | 7 |
| full[- ]suite | 3 | 35 |
| lint\|knip | 10 | 9 |
| retro | 0 | 0 |
| feedback triage\|bbx feedback | 20 | 25 |
| boxholder (human-raised) | 112 | 132 |

```sh
grep -L '^discovered-in:' -r issues --include='*.md' | wc -l    # issues with no discovered-in field
```
```
204
```

Observation: full-suite-discovered issues are 35 closed vs 3 open (they get fixed); journey-walk-discovered issues are 43 open vs 39 closed (they accumulate).

## 6c. Commits reporting that a technique caught something (developer addition)

Two measures. Strict phrase: a detection verb + preposition followed within 40 characters by the source word.

```sh
V='(caught|found|surfaced|flagged|spotted|detected|exposed) (by|in|during|from|via)'
git log -i -E --grep="$V [^.]{0,40}(<src>)" --format=%h | wc -l
```

| source regex | commits |
|---|---|
| tests? | 7 |
| doctests? | 1 |
| lint\|eslint\|knip | 4 |
| full[- ]suite | 3 |
| bisect | 0 |
| cross-model\|codex\|gpt | 13 |
| review | 21 |
| audit | 1 |
| tour | 2 |
| journey\|walk | 3 |
| schedul\|nightly\|hourly\|weekly | 2 |
| smoke | 3 |
| typecheck\|tsc | 0 |
| any of the above | 44 |

10 most recent strict matches:

```sh
git log -i -E --grep="$V [^.]{0,40}(tests?|doctests?|lint|eslint|knip|full[- ]suite|bisect|cross-model|codex|review|audit|tour|journey|walk|schedul|smoke|typecheck)" --format='%ad %h %s' --date=short | head -10
```
```
2026-10-08 1ded98a0a Issue: box chat agents load the host Claude account's connectors
2026-10-07 7b1a72906 File session-retention 64 MB heap-cap flake found by knip-sweep
2026-09-28 cf0738a5c Prototype: never rewrite an import inside a template literal
2026-09-27 69414cfbe Layout moves: fix stale scripts/ paths surfaced by test:changed
2026-09-18 a8a67c3d7 refresh-maps: stamp the brief's HEAD; ignore the agent's own usage writes
2026-09-13 7ba8be1b1 fix(history): migrate a pre-rename link's serialized filter state
2026-09-12 8cc1141e9 feat(templates): let the stock-hash ledger adopt a version that shipped before it
2026-09-10 a0130fe3c Fix voice-staging queue bugs found by cross-model review
2026-09-02 aaa69fe1d issues: file the admin "Available engines" run-on label found by the weekly tour check
2026-08-28 1a5d273c8 fix(tests): the place-switch step read the menu by display name, which a healthy box breaks
```

Loose sentence-level measure (`caught.py`): a commit counts for a source when any sentence of its message contains both a detection verb (caught/found/surfaced/flagged/detected/exposed/revealed/spotted/turned up/reported and inflections) and the source word. Noisier (e.g. "not found", "walk" as a verb), useful for the month shape.

```sh
python3 -I caught.py
```

| source | commits | 2026-01 | 2026-02 | 2026-03 | 2026-04 | 2026-05 | 2026-06 | 2026-07 | 2026-08 | 2026-09 | 2026-10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| test (any) | 78 | 0 | 0 | 0 | 0 | 5 | 5 | 14 | 29 | 23 | 2 |
| doctest | 49 | 0 | 0 | 0 | 0 | 3 | 4 | 13 | 13 | 13 | 3 |
| lint | 59 | 0 | 1 | 0 | 1 | 9 | 4 | 12 | 17 | 12 | 3 |
| full-suite | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 2 | 0 |
| bisect | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cross-model / codex review | 134 | 0 | 0 | 0 | 0 | 0 | 11 | 38 | 58 | 24 | 3 |
| review (any) | 150 | 0 | 0 | 0 | 1 | 2 | 8 | 39 | 62 | 35 | 3 |
| audit | 21 | 0 | 0 | 0 | 0 | 3 | 1 | 5 | 1 | 10 | 1 |
| tour | 6 | 0 | 0 | 0 | 0 | 1 | 0 | 1 | 2 | 2 | 0 |
| journey walk | 34 | 0 | 0 | 0 | 1 | 5 | 1 | 1 | 16 | 6 | 4 |
| schedule | 36 | 0 | 1 | 0 | 1 | 1 | 2 | 6 | 16 | 8 | 1 |
| smoke | 12 | 0 | 0 | 0 | 1 | 0 | 1 | 5 | 4 | 1 | 0 |
| typecheck | 7 | 0 | 0 | 0 | 0 | 1 | 2 | 2 | 1 | 1 | 0 |

Commits with at least one match: 392

10 most recent matches:

- 2026-10-08 00db2a570 Place page: link tiles show titles only, no file paths  [journey walk]
- 2026-10-08 0067d309e Speech: never speak or show a legacy <instructions> child that has attributes  [cross-model / codex review, review (any)]
- 2026-10-08 09fdbd0d5 Unexport symbols whose only outside consumer was a removed test  [lint, test (any)]
- 2026-10-08 6cb86ff39 Test cleanup batch 2: frontend doctests  [doctest]
- 2026-10-08 ee5289dd1 browse: resolve upload paths against the caller's directory  [journey walk]
- 2026-10-08 1ded98a0a Issue: box chat agents load the host Claude account's connectors  [journey walk]
- 2026-10-07 0ba66d2ee mac-app: ~/BeeBox/<name> boxes and a shared "Bee Box" support folder; gentle update reminders  [schedule]
- 2026-10-07 7b1a72906 File session-retention 64 MB heap-cap flake found by knip-sweep  [lint]
- 2026-10-06 75e713c5d Security report amendment, plan active, and out-of-scope issues  [journey walk]
- 2026-10-06 528d81318 Point box-agent guidance at the box screen  [audit]

### Reverts

```sh
git log --format=%s | grep -c '^Revert'                               # subject starts with Revert
git log -E --grep='^Revert' --format='%ad' --date=format:%Y-%m | sort | uniq -c   # any message line starting Revert (17)
```
```
12   (subject-line reverts, out of 8778 commits)
17 by message line: 2026-03 1, 2026-04 2, 2026-05 4, 2026-06 1, 2026-07 1, 2026-08 6, 2026-09 2
```

## 1b. Commits with no co-author trailer

```sh
git log --no-merges --format='%ad|%(trailers:key=Co-Authored-By,valueonly,separator=%x2C)|%(trailers:key=Claude-Session,valueonly,separator=%x2C)' --date=format:%Y-%m | awk -F'|' '$2==""{n[$1]++} END{for(k in n)print k, n[k]}' | sort
```
```
2026-01 2 | 2026-02 9 | 2026-03 3 | 2026-04 13 | 2026-05 106 | 2026-06 10 | 2026-07 183 | 2026-08 632 | 2026-09 323 | 2026-10 47   (total 1328 non-merge commits)
```
None of these carry a Claude-Session trailer either. Only one commit carries `Co-Authored-By: OpenAI Codex` (2026-03-06), but transcripts show 857 Codex top-level sessions in this repo since 2026-06-04 (section 12), so most of these 1,328 unattributed commits are probably Codex-driven or scripted (snapshots, schedule output). Not verified per commit.

Merge breakdown (most merges are main synced into a worktree branch, not landings):

```sh
git log --merges --format=%s | sed -E "s/^Merge (remote-tracking )?branch '?([^' ]+)'?.*/\2/" | awk '{print ($0 ~ /^worktree-/)?"worktree-*":($0 ~ /^main$|origin\/main/)?"main":"other"}' | sort | uniq -c
```
```
1099 main (Merge branch 'main' [into worktree-x])
 600 worktree-* (a worktree landing on main)
  46 other
```

## 12. Transcript aggregates (counts only)

Claude Code prunes old transcripts, so local files cover only the last ~2.5 months; earlier months are not measurable this way.

```sh
cd ~/.claude/projects
ls -d ./-<home>-src-beebox* ./-<home>-src-callback* | wc -l          # 286 project dirs (one per checkout path)
ls -d ./-<home>-src-beebox-worktrees* | wc -l                                  # 208 worktree project dirs
find ./-<home>-src-beebox* ./-<home>-src-callback* -maxdepth 1 -name '*.jsonl' | wc -l   # 230 top-level sessions still on disk
find ./-<home>-src-beebox-worktrees* -maxdepth 1 -name '*.jsonl' | wc -l        # 128 of them in worktree dirs
find ./-<home>-src-beebox* ./-<home>-src-callback* -name '*.jsonl' | wc -l             # 2294 incl. subagent transcripts
find ... -maxdepth 1 -name '*.jsonl' -exec stat -f '%Sm' -t '%Y-%m' {} + | sort | uniq -c  # sessions by mtime month
find ... -mindepth 2 -name '*.jsonl' -exec stat -f '%Sm' -t '%Y-%m' {} + | sort | uniq -c  # subagents by mtime month
find ~/.codex/sessions -name '*.jsonl' | awk -F/ '{print $(NF-3)"-"$(NF-2)}' | sort | uniq -c   # Codex rollouts, all cwds
```

| month | Claude top-level sessions | Claude subagent transcripts | Codex rollouts (all repos) |
|---|---|---|---|
| 2026-06 | 0 | 0 | 48 |
| 2026-07 | 0 | 159 | 199 |
| 2026-08 | 85 | 876 | 717 |
| 2026-09 | 97 | 734 | 659 |
| 2026-10 (to 9th) | 48 | 295 | 126 |

Codex total rollouts on disk: 1782 (including 33 from 2025-09..2026-04, other projects).

`bin/skill-usage.ts` (filters to sessions whose cwd is this repo or a worktree):

```sh
node --import tsx bin/skill-usage.ts --since 400     # ~37 s
```
```
claude: sdk 49, interactive 181 top-level sessions; 2057 subagent transcripts; first event 2026-07-21
codex:  exec 718, sdk 2, interactive 137 top-level sessions; 298 subagent transcripts; first event 2026-06-04
Monthly skill invocations (claude / codex): 2026-07 15/79, 2026-08 296/1401, 2026-09 319/1373, 2026-10 124/188
Top skills by sessions: finish 290, cross-model 268, browse 128, bbx-plan 117, doctest 86, issues 85, bbx-ios-overlap 40, knowledge-audit 35
Human turns scanned: claude 2694 in 166 sessions; codex 1187 in 125 sessions
Recurring human instructions (sessions, claude+codex): finish/land/merge 64+114; approve/go ahead 86+43; plan 37+30;
  keep going 39+22; investigate 34+22; cross-model/Codex review 28+17; look in browser 29+15; file an issue 33+7;
  delegate/subagent/spin off 19+9 (139 claude turns); shorter/simpler 21+6
```

## 13. Inflection markers

Biggest non-merge commits by files changed:

```sh
git log --no-merges --format='@%h %ad %s' --date=short --shortstat | awk '/^@/{h=$0;next} /files? changed/{print $1"\t"substr(h,2)}' | sort -rn | head -12
```
```
4188  dab834811 2026-08-30 feat!: rename the former product name to Bee Box
 736  079410e97 2026-09-27 Layout moves: foundation (code changes, registries, cleanup)
 653  efb613eb9 2026-09-27 Layout moves: frontend
 641  8e3a98c0a 2026-09-27 Flip shared/lib layer order: shared is now the leaf
 630  2558bb3c0 2026-09-27 Layout moves: core
 613  b66aed4f3 2026-08-09 Enforce plan and issue frontmatter
 535  3f1935840 2026-09-27 Layout moves: integrations
 527  b51f0675a 2026-09-04 One-root consumer sweep: retire packageRoot, re-point every v2 path (Track A2)
 357  ceaf0cd57 2026-09-27 Layout moves: packages
 356  b70dedfa8 2026-09-27 Layout moves: webapp
 316  29532938c 2026-09-27 Layout moves: annotate old-path mentions with their new location
 301  881eb9dab 2026-09-27 Rewrite pre-move path mentions across the repo (mentions-from-git)
```

Longest gaps between consecutive commits (all histories, by author time):

```sh
git log --format='%at %ad' --date=short | sort -n | awk 'NR>1{g=$1-p; print int(g/3600)"h", pd, "->", $2} {p=$1; pd=$2}' | sort -rn | head -6
```
```
97h 2026-03-25 -> 2026-03-29
93h 2026-04-03 -> 2026-04-07
77h 2026-05-05 -> 2026-05-09
76h 2026-02-03 -> 2026-02-06
70h 2026-03-30 -> 2026-04-02
64h 2026-04-24 -> 2026-04-26
```
No gap over 64 hours after 2026-05-09.

Busiest days:

```sh
git log --merges --format=%ad --date=short | sort | uniq -c | sort -rn | head -5
git log --format=%ad --date=short | sort | uniq -c | sort -rn | head -5
git log --format=%ad --date=short | sort -u | wc -l
```
```
merges: 92 2026-09-12 (52 of them 'main' merged into worktrees; 23 worktree-agent-docs), 75 2026-10-06, 68 2026-09-05, 61 2026-08-25, 58 2026-10-08
commits: 243 2026-10-06, 226 2026-09-12, 214 2026-09-26, 205 2026-10-08, 190 2026-08-24
active days: 226 (of 256 calendar days from 2026-01-27 to 2026-10-09)
```

Process-tooling dates to anchor a timeline (from sections above):
- 2026-01-27 first commit (cardworks); 2026-01-29 <old-package> begins.
- 2026-03 first doctests in tree (59 files by 2026-04-01); agent-doctest extracted 2026-03-09.
- 2026-05-26 monorepo assembled from 5 repos; first "worktree" subjects (61 in May).
- 2026-06: first .claude/skills (4 by 2026-06-01), first docs/plans (18 open + 34 implemented by 2026-07-01), first Claude-Session trailer 2026-06-18, first Fable co-author 2026-06-09, first Codex-in-subject commits (21).
- 2026-07-04 issues/ replaces ideas.md (218 open / 113 closed by 2026-08-01).
- 2026-08-24 Workstream/Plan/Issue trailers begin; first four schedules; 2026-08-25 full-suite schedule; 2026-08-26 tour-check, smoke-review.
- 2026-08-30 rename to Bee Box (4188 files).
- 2026-09-12 beebox/CLAUDE.md cut from 184 to 67 lines (d7b47dfde); busiest merge day (92).
- 2026-09-27 layout moves (8 commits, 300-740 files each).
- 2026-10-07 retrospective schedule (15th schedule).

## Summary

- Pace: 8,778 commits in 256 days, one human author. Monthly commits rose from 201-266 (Feb-Apr) to 1,510 (Jul) and 2,305 (Aug), then held at 2,268 (Sep). July-September is 69% of all commits. 222 distinct worktree branches have been merged; worktree landings went from 6 (May) to 305 (Sep).
- Size: non-blank code lines grew from 11.9k (Feb 1) to 390k (HEAD), 33x. Doctests grew from 0 to 1,035 files and 141k lines; they are 83% of test lines. Docs grew faster than code after July: plans/reports went from 0 to 113k lines and issues from 0 to 65k lines. At HEAD, plans + issues + other docs (~246k lines) are about 63% of code lines.
- Process scaffolding arrived in a burst between June and August 2026: skills (June), plans (June), issues/ (2026-07-04), provenance trailers and schedules (2026-08-24 onward). 1,184 issues were filed and 717 closed (625 implemented). 15 schedules were added between 2026-08-24 and 2026-10-07.
- Model mix: 19 distinct Co-Authored-By values, which follow the model releases (Opus 4.5 → 4.6 → 4.7 → 4.8 → Fable 5 → Opus 5 → Fable 5.1 → Opus 5.5). Codex appears as a co-author only once. Codex transcripts nevertheless show 857 sessions in this repo, and 1,328 non-merge commits carry no co-author trailer. Commit trailers therefore undercount Codex.
- Evidence that techniques find things: 134 commits pair a detection verb with cross-model/Codex in one sentence, the largest source. Of issues whose discovered-in names a source, full-suite finds were almost all closed (35 closed vs 3 open); journey-walk finds stay open about half the time (43 open vs 39 closed). There were only 12 subject-line reverts.

Could not compute:
- Transcript counts before late July 2026, because Claude Code prunes old transcripts.
- Per-commit attribution of the 1,328 no-trailer commits.
- An exact `resolved-by` count, because that field does not exist.
- Open-issue counts at month end before issues/ existed (it began 2026-07-04).
- The doctest "added per month" figures by path, which the 2026-09-27 layout moves distort; the net counts in section 3 are reliable.
