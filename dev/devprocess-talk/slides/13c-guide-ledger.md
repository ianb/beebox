# Every rule earns its place, and the size is a number
## Supporting: the box agent guide's ledger and one law
```yaml
budget:
  # Measured on the test clone after each section is binned, so the ceilings
  # ratchet down… Raised 2026-10-07 (+28) for the managed browser-task box
  # skill's description (skill descriptions are always loaded)
  guide_words: 5595
  always_loaded_words: 10330

  - id: laws.quoting-data
    rule: The user's data values (quantities, units, names, dates) stay as given; convert only when asked and say so…
    handle: THE_LAW_OF_QUOTING
    bin: law
    reason: The same silent rewrite applied to data; added after an agent turned "1 tbsp" into "1 T" in a field test.
    audits: [law-data-fidelity-units]

  - id: about-cards.not-xml
    rule: Cards are not XML.
    bin: delete
    reason: History; the shape sentence says what a card is.
```
- 142 rows: 11 law, 82 core, 32 indirect, 17 delete. "A new law needs a failure someone has seen"
- Before: 3,355 words in April → 11,435 in September, "one justified paragraph per feature, because nothing asked each paragraph to earn its place"

Notes:
Path: beebox/src/core/agent-guide/ledger.yaml. Each paragraph of the rendered guide carries a comment naming its rows; each row names the audits that test it. This is the one instruction surface in the repo with an enforced budget.
