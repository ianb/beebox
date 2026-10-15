# A repeat sighting is evidence
## Supporting: issues/CLAUDE.md, "Re-encountering an issue"
- Each repeat has a defined state transition, including the one case where an agent may remove a human-owned gate

```markdown
A repeated symptom or report is new evidence. Add a dated body note stating
where and under what conditions it appeared, then apply the matching transition:

- An issue awaiting manual testing is not fixed if the reported behavior recurs.
  Remove `manual-testing`, keep its section as history, make the re-encounter
  the opening status, and treat it as an open bug. This is the explicit
  agent-removal exception to the human-owned gate.
- Reopen a closed issue with `git mv`, remove `resolution:`, and record what the
  previous fix missed. Keep a new report separate only when it is a different
  defect.
```

Notes:
"Filing an item does not authorize implementation" is the opening line of the same file. The October journey round recorded 15 re-encounters under this rule.
