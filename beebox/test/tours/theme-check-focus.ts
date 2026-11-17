/** Normal navigation is measured first; focused layout then exercises its own shared rules. */
import type { BrowseSession } from "./tour-lib/browse.js";
import { ThemeCheckError } from "./theme-check-run.js";
import type { Screen } from "../../src/shared/theme-screens.js";

export async function checkFocusedStudio(session: BrowseSession, { screen, name, check }: { screen: Screen; name: string; check: (state: string) => Promise<number> }): Promise<number> {
  const normal = await check("normal");
  // The four focus rules have no viewport variants. One desktop screen per case is sufficient.
  if (screen.name !== "laptop") return normal;
  try {
    const focus = ".bbx-companion-desk:has(#bbx-studio-tabs-reading) #bbx-pane-left-focus";
    await session.run(["scrollintoview", focus]);
    await session.run(["click", focus]);
    await session.run(["wait", ".bbx-companion-desk[data-card-focused]"]);
    const focused = await check("focused");
    await session.run(["scrollintoview", "#bbx-pane-left-unfocus"]);
    await session.run(["click", "#bbx-pane-left-unfocus"]);
    await session.run(["wait", ".bbx-app-nav"]);
    return normal + focused;
  } catch (cause) {
    throw new ThemeCheckError(`could not audit focused studio and return to normal for ${name}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}
