# Plan review: doc-move-and-issue-close

Reviewer: codex gpt-6-sol, plan mode, 2026-10-29. Findings in the reviewer's
rank order, each with its adjudication.

1. **doc-check is no safety net for missed reference forms.** The plan relied
   on doc-check to catch reference-style links and HTML `href` paths, but the
   graph extractor does not read those forms, and it resolves a stale inline
   link by basename (`beebox/src/dev/doc-graph-data/data.ts:223`).
   *Accepted.* The plan adds a residual check: remaining tokens that end in the
   moved basename and resolve to the old path are reported on stderr.
2. **Already-broken own links left as written change meaning after the move.**
   *Accepted.* Own links are re-depthed by path arithmetic even when the target
   is missing, and also listed on stderr.
3. **A public move writes into the private repository.** *Partly accepted.*
   The citation of `repairPrivateLinks` was wrong (it walks the filesystem);
   fixed. Writes stay: private referrers are labeled in the output, and the
   finish agent's private-leg gate refuses to land while `private-issues/` is
   dirty. A planner test covers the private label.
4. **Write failure after `git mv` leaves partial state.** *Accepted as a
   documented risk*: a one-shot operator tool, and `git status` shows the
   partial state. The plan's "Partial state: none" line was corrected.
5. **"First existing candidate" is a new rule, not doc-check's.** *Accepted.*
   A token for which the moved file and another candidate both exist is now
   reported as ambiguous and not rewritten.
6. **Infrastructure larger than needed; scan policies are not one scope.**
   *Rejected in part.* The extraction moves constants only and keeps the three
   predicates separate; the plan text now says so. The budget stays.
7. **Untracked files cannot be moved with `git mv`.** *Accepted.* The
   ontology now says tracked only; the code refuses an untracked source.
