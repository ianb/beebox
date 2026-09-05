---
name: feedback-form-as-prompt
description: "For analytical/evaluation tasks, prefer structured \"fill in this form\" templates with explained criteria over numeric scores or free-form prose"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6f088193-eb30-436c-80bbx-1b6a986f9034
---

For analytical or evaluation work (code review, plan critique, security audit, design review, etc.), prefer a **form-as-prompt** structure over numeric confidence scores OR unstructured prose.

The shape:
1. The prompt defines a **form** with named sections (one per check or dimension).
2. Each section has **carefully explained criteria** — checkboxes, sub-questions, or explicit fields — that teach the reader (and the AI) why this check matters.
3. The AI **fills in the form**, addressing each criterion explicitly with evidence and reasoning.
4. The filled-in form is itself a **reference document** — readable, scannable, attachable, evolvable. Form + filled answers together teach what was checked, why, and what was verified.
5. Include a "what would change my mind" / falsifiability field where appropriate.

**Why:** Ian finds numeric confidence (e.g. "confidence: 7/10") an awkward proxy for verification — the number has to be calibrated against thresholds the reader can't see. Free prose is hard to audit because nothing forces criterion-by-criterion coverage. A criteria-checkbox form with prose evidence in each cell:
- Makes verification inspectable (you can read whether each criterion was actually checked)
- Teaches the reader what each check is for (criteria are explained, not just named)
- Produces a portable artifact (the filled form composes, evolves, ships)

**How to apply:** When writing or recommending prompts/skills for review-like tasks, structure the output as a filled-in form whose fields have explained criteria. Don't introduce numeric confidence scores. Don't dump unstructured prose. Compatible with the citation/verification-gate discipline from [[notes-ship-pipeline]] (evidence sections satisfy the citation requirement).

Generalizes to: code review, plan critique, office-hours-style product evals, security audits, design reviews, AI-evaluation tasks broadly.
