---
title: "iOS Open directory can leave the web page unresponsive while native controls still work"
workstream: chat-everywhere
area: beebox
labels: [ios, navigation, chat]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-chat-everywhere — physical-device acceptance after chat input everywhere landed
---

The boxholder selected the chat Here menu's Open directory action in the iOS
app. The web page froze, while the native wrapper still worked. A second
attempt succeeded. The precise recovery action and whether scrolling also
stopped are not yet established.

The rolling device/browser log around the report contains navigation and
composer-binding readiness messages, but no JavaScript error or native
navigation failure explaining the freeze. Absence of a log does not establish
that the web content process remained responsive.

Eight repeated mobile-viewport Chromium runs of the actual Here menu and Open
directory action completed with a responsive destination page. These are not
WebKit or physical-iPhone reproductions.

A separate defect was reproduced on the same action: its plain anchor caused
a full document reload, replacing the persistent composer. A browser marker
check showed both document and composer identity changed. The chat menu now uses in-app
navigation, matching the non-chat menu. The same browser marker check passes
with document and composer identity preserved. This addresses input continuity;
it must not be called a fix for the reported freeze without a device
reproduction or confirming evidence.

Continue from the boxholder's description of the frozen state and recovery.
If the failure recurs, capture navigation start/finish, web-process liveness,
and the destination rendering boundary around that attempt. Avoid speculative
render/controller changes without a red-capable reproduction.

Related: [chat input everywhere](../features/2026-08-30-chat-input-everywhere.md).
