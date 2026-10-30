// # Directory renderer — which paths it claims
//
// A path is a directory when its last segment has no extension or the path
// ends in a slash. A card's attach folder (`Name.attach`) is the exception
// with a suffix: without it, a link to `Family.attach` opened as an empty
// text file.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { directoryRenderer } from "../../src/renderers/directory.js";

void test("attach folders are directories with or without the trailing slash; files inside are not", (t) => {
  const { selector } = directoryRenderer;
  const claims = (path: string): boolean => "match" in selector && selector.match(path);
  t.check(
    ["_content/calendar/Family.attach", "_content/calendar/Family.attach/", "_content/calendar", "",
      "_content/calendar/Family.attach/2026-11-05_Dentist_a1b2c3d4.ics", "_content/calendar/Family.calendar.card", "notes/.attach"]
      .map((path) => [path, claims(path)]),
    [
      ["_content/calendar/Family.attach", true],
      ["_content/calendar/Family.attach/", true],
      ["_content/calendar", true],
      ["", true],
      ["_content/calendar/Family.attach/2026-11-05_Dentist_a1b2c3d4.ics", false],
      ["_content/calendar/Family.calendar.card", false],
      ["notes/.attach", false],
    ],
  );
  t.end();
});
