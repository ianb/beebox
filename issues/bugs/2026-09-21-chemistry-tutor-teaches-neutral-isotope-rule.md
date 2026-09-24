---
title: "Chemistry tutor teaches a false isotope rule before correcting it"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walk — journey D chemistry study
---

A learner confused isotopes with ions. The tutor gave them a memorable but
false rule: “isotopes are neutral, ions are not.” It also said “an isotope
has no charge.” Screenshot 05 in the [journey D report](../../beebox/user-stories/journeys/D-chemistry/reports/2026-09-21.md)
independently shows both sentences. The learner latched onto this as a useful
rule before the tutor corrected it in its next response.

Isotope identity concerns atomic number and mass number; ion identity concerns
net charge. These are independent properties. The IUPAC definitions of
[isotopes](https://goldbook.iupac.org/terms/view/I03331) and
[ion](https://goldbook.iupac.org/terms/view/I03158) support that distinction.
An initially neutral carbon example does not justify saying all isotopes are
neutral.

The tutor subsequently acknowledged the mistake, introduced independent
“dials”, and saved the corrected explanation. That recovery is real, but the
learner's closing verdict was that confident rules now needed checking against
the textbook. This was an observed teaching-output failure, not a proven
schema defect or deterministic prompt bug. No prompt or product fix was made.

Preserve this case when evaluating course teaching and correction behavior.
Do not treat the successful correction as evidence that the initial teaching
was accurate, or this simulated exercise as a measured learning outcome.

## Existing grounding guidance

`beebox/src/core/box/skills-content.ts:134–139` already instructs the
build-course skill to ground teaching in authoritative sources, bring those
sources into the box, and cite at the strength they support. The run transcript
records a `build-course` Skill call at 11:57:37.144Z, before this explanation.
The issue is therefore not simply absent advice to use sources; the loaded
guidance did not prevent this unsupported teaching claim. That identifies the
existing instruction surface, not a proven deterministic cause or effective fix.

The same run ended with an acknowledged source gap for the oxygen-18 ice-core
example. `Three_Dials_Recap.doc.card:116–120` assigns the reference work to the
agent, and screenshot 25 explicitly says the recap currently has no source.
This is related grounding evidence, not evidence that the ice-core claim is
false. No citation was added to that saved claim before the walk ended. Whether to
change the guidance or enforce it through another mechanism remains a product
choice; no enforcement subsystem is implied by this issue.

## Next-action check (2026-09-24)

Checked 2026-09-24 for `invalid`: still holds. The grounding guidance it cites (`beebox/src/core/box/skills-content.ts:134-139`) is unchanged, and no commit references the issue. The issue is a case record for teaching-output evaluation, not a code-fix request, so "no fix landed" does not make it invalid.
