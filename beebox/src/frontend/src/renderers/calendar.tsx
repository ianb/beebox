/**
 * Calendar card renderer — registers the CalendarView front for calendar cards.
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const calendarRenderer: RendererEntry = {
  selector: { type: "calendar" },
  renderer: { name: "Calendar", Component: lazyComponent(() => import("../components/CalendarView/view"), (m) => m.CalendarView), priority: 100 },
};
