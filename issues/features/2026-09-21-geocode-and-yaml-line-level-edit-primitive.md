---
title: "Use case worth first-class support: geocode a card's address, and the underlying 'edit one YAML list entry without reserializing the file' primitive it needs"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

A production box's agent wrote a geocoding trick because cards with addresses
wanted lat/lng for map views, and nothing in the platform offers this. It used
Nominatim (OpenStreetMap's geocoder), rate-limited to 1 request/second per
Nominatim's usage policy, and did a hand-rolled line-level YAML edit to add
the coordinates to an existing address entry without reformatting or
reserializing the rest of the file.

## Two distinct gaps

1. **No geocoding helper.** Any box that maps places (events, studios,
   people's addresses — anything with a location-bearing card type) will need
   to turn a free-text address into coordinates, and will reach for the same
   external geocoder under the same rate limit if nothing built-in exists.
   This could be a `bbx` command, a library helper tricks can call, or a
   documented pattern — the box's ask is only that it not be reinvented
   per-box.
2. **No safe "edit one YAML list entry in place" primitive.** The trick
   needed to add a field to one entry of a YAML list (an address among
   several) without a full parse-and-rewrite pass, because reserializing a
   card's frontmatter risks reordering keys, changing quoting/wrapping style,
   or otherwise producing a large diff for a one-field change. This is a more
   general need than geocoding — anything that patches one field of one list
   entry in a card's frontmatter faces it.

## Why the design is not obvious

- A generic "edit one YAML list entry in place" primitive has to define what
  "in place" means precisely: which entry counts as a match (by index? by a
  key like a name or a `ref`?), and how it behaves if the file's existing
  formatting is already inconsistent (mixed quoting, flow vs. block style).
  Getting this wrong risks producing valid-but-surprising diffs, which is
  exactly the failure mode the box was trying to avoid by hand-rolling it.
- Geocoding as a built-in raises API-key/provider questions (Nominatim's
  policy explicitly discourages high-volume automated use without
  attribution and a real user agent) that a shared helper would need to
  surface to box authors rather than hide.
- It is unclear whether this belongs as a `bbx` CLI command, a library
  function tricks import, or just a documented recipe — the box's own report
  frames it as "a built-in or blessed library helper," leaving the shape open.
