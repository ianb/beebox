---
title: "Box source lists: store each source's structured data URL and re-check it, with Exa for discovery"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: Ian
discovered-in: worktree-web-search-fetch — survey of web search and fetch services
---

A box that tracks a scene (events, studios, people) cannot rely on search to
find small sources each pass. In a 2026-10-15 trial, research-dispatch services
and a search loop each found 3 of 14 events a box already knew, a different 3
each time ([survey](../../research/web-search-fetch/README.md)). The
boxholder's direction: accept imperfect search, and grow a "look here" list of
sources as they are found, re-checked on each pass.

What the survey found that makes the re-check cheap
([oss-fetch-and-feeds](../../research/web-search-fetch/oss-fetch-and-feeds.md)):
most event sources expose structured data over plain HTTP, with no browser.

- WordPress with The Events Calendar: `/wp-json/tribe/events/v1/events`, or
  `/events/?ical=1`.
- Squarespace: `<collection>?format=json` (upcoming and past arrays), or
  `?format=rss`.
- Embedded Google Calendar: the public ICS URL. Embedded Google Sheet:
  `/export?format=csv`.
- Eventbrite: JSON-LD `Event` objects on the page.
- Wix and ticketing platforms (ActiveNet, Eleyo, BoothCentral, EntryThingy):
  no feed found; these need a rendered page read.

Shape to consider: each source in the list records its platform and data URL,
detected once when the source is added; a pass fetches the data URL and
compares against the last fetch; Exa (keyless hosted MCP) runs discovery
queries that propose new sources. Facebook and Instagram sources stay on the
browser-task route.

Open questions: whether the box agent may write the detected platform and
data URL into the list itself; whether this is box guidance plus a helper
command, or a card field.
