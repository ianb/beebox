# Privacy and egress

Who can see a box's content, and when that content may leave the box. The
mechanisms live in the linked docs and code; this file holds the stance.

## One box, one circle

Members of a box share everything in it, and nothing is shared across boxes;
a group that needs a smaller circle needs another box (`identity.md`). A box
reaching another box's secret does so through a grant, never a copied file
([`../secrets.md`](../secrets.md)).

## Nothing leaves without a grant

Box content leaves the box only through something the boxholder granted,
because each grant is a decision a person can find and revoke later.

- **Gmail is read plus drafts.** The connector has no send path, so the box
  cannot send mail on its own; sending stays a person's act in Gmail
  ([`../security-overview.md`](../security-overview.md#what-leaves-your-machine),
  `src/google/auth.ts`).
- **A secret grant is per-box consent for one purpose.** A transcription key
  is not consent to pay for embeddings, so purposes get separate names and
  each box opts in separately ([`../secrets.md`](../secrets.md)).
- **Outside models need a granted key.** Beyond the box's own agent engine,
  box content reaches an outside model only through a key granted to that
  box ([`../security-report.md`](../security-report.md#3-data-egress)).

## Box content stays out of the public repo

The source is published and boxes are private, so box content never enters the
repository (issues, commits, test fixtures) without the boxholder's scrub;
private specifics go to the separate `private-issues/` repository
(`beebox/CLAUDE.md`, [`../../../issues/CLAUDE.md`](../../../issues/CLAUDE.md)).
