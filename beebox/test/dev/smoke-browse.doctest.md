# Smoke recognizes Browse as a card without weakening content checks

```javascript
const { isBrowseCardUrl, browseListingModeRef } = await import("../../../bin/smoke-browse.ts");
const { cardViewRendered, directoryRowCount } = await import("../../../bin/smoke-snapshot.ts");
const cardUrl = new URL("http://localhost:3210/work/test1/chat");
cardUrl.searchParams.set("card", '_config/interface/browse.card?viewState={"directory":"_content"}');
isBrowseCardUrl(cardUrl.href)
=> true

isBrowseCardUrl("http://localhost:3210/work/test1/chat?card=_config/interface/dashboard.card")
=> false

isBrowseCardUrl("http://localhost:3210/work/test1/browse/_content")
=> false

isBrowseCardUrl("http://localhost:3210/work/test1/chat?card=_config/interface/browse.card.copy")
=> false

browseListingModeRef('- switch "Showing compact listing — switch to raw" [checked=false, ref=e30]')
=> e30

browseListingModeRef('- switch "Showing raw listing — switch to compact" [checked=true, ref=e30]')
=> null

directoryRowCount('- region "Browse" [ref=e26]\n- button "Content directory, 197 items" [ref=e31]')
=> 1

directoryRowCount('- region "Browse" [ref=e26]')
=> 0

// The smoke caller scopes this snapshot to the selected file's panel, excluding
// the outer Browse title and sidebar landmark headings.
cardViewRendered('- link "Open full view →" [ref=e27]')
=> false

cardViewRendered('- link "Open full view →" [ref=e27]\n- heading "Memo" [level=2, ref=e28]')
=> true

```
