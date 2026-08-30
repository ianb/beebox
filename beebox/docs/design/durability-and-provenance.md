# Durability and provenance

## Committing makes it durable and real

The filesystem is the canonical **state**; git is the canonical **history**.
On top of that, "to do something, commit it" is **active and true guidance**
(ruling 13): committing something is what makes it durable and real. Connector
syncs commit what they pulled; agents commit their work (with
`ensureAgentCommitted` as a backstop so half-finished work isn't lost);
commits carry structured trailers (`Created-By`, `Retro-Run`) that make
history queryable. Not everything works this way — chat messages, notably,
aren't commit-mediated — but a lot does, and new features should default to it.

What did *not* survive: "commit as action" — the command-card lifecycle where
a validation-gated status flip drove execution. Nothing is commit-*triggered*
today; actions run through reactor jobs and `bbx finalize`, and commits record
what happened.

## The filesystem is the index

Directory location and status fields determine what has and hasn't been
processed — there is no external queue or database to consult. Wakeup and the
reactor decide what needs doing by inspecting the tree (pending job cards in
`box/jobs/`, unjobbed inbox items, `status:` fields), which is why wakeup is
idempotent: call it anytime; it looks and acts. (Salvaged from the MVP
implementation guide — this framing predates the reactor and still holds.)

## Provenance: aspiration, with real attempts

The original design declared provenance — every artifact retaining where it
came from as it moves and transforms — a first-class invariant. **It is
aspirational** (ruling 14): the system does not keep enough reference
information for end-to-end traceability (action → the input that caused it),
especially when the source was a chat message.

The current attempts, which are real but partial: the `{% source %}` and
`{% quote %}` Markdoc tags (attribution and exact-words preservation in card
bodies), per-schema source fields where schemas require them, and commit
trailers. Direction of travel: always can be better — when adding a data path,
carry the source along rather than widening the gap.
