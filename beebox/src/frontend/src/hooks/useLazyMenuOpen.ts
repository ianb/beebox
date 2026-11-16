/**
 * First-open latch for a dropdown menu's lazily-fetched data
 * (`plan:top-nav-ia` Track C1's pattern for the switch menu, reused
 * by `plan:card-prominence` Track B for the here menu's link list).
 * The query stays gated behind `enabled: opened`; once true it stays true,
 * so a later open reads from react-query's cache while `open()` asks for a
 * background refresh instead of blanking the menu.
 */

import { useState } from "react";

export function useLazyMenuOpen(invalidate: () => void): { opened: boolean; open: () => void } {
  const [opened, setOpened] = useState(false);
  function open(): void {
    if (opened) {
      invalidate();
      return;
    }
    setOpened(true);
  }
  return { opened, open };
}
