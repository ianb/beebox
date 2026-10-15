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

Boxholder decisions (2026-10-15):

- How a box updates its list is the box's own policy. The default is that the
  agent adds sources automatically as it finds them.
- No change-detection service. A box writes its own scripts (tricks) that
  fetch its sources on a schedule.
- What beebox ships is a standard: a box doc of suggested approaches the
  agent reads when it builds those scripts. It covers the data-URL patterns
  above, detecting a source's platform once and storing its data URL with the
  source, Exa for discovering new sources, the fetch fallback for pages with
  no feed, and the browser-task route for Facebook and Instagram.

Open question: where the doc lives among the box docs.

A helper waits (boxholder, 2026-10-15: "maybe there should be a helper, but
I'm unclear we know what it should do now"). Ship the doc first; once boxes
have written source scripts from it, look at what those scripts repeat and
extract that.
