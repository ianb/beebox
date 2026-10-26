/** Read-only observation of the server's per-box backup timer. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function serverBackupTimerStatus(slug: string): Promise<"enabled" | "disabled" | "unavailable"> {
  if (!/^[\da-z][\da-z-]*$/.test(slug)) return "unavailable";
  try {
    const { stdout } = await execFileAsync("systemctl", ["show", "--no-pager", `beebox-backup@${slug}.timer`, "--property=UnitFileState,ActiveState"], {
      timeout: 5_000,
      maxBuffer: 1024,
      encoding: "utf8",
    });
    const state = Object.fromEntries(stdout.trim().split("\n").map((line) => line.split("=", 2)));
    if (state.UnitFileState === "enabled" && state.ActiveState === "active") return "enabled";
    if (state.UnitFileState === "disabled" || state.ActiveState === "inactive") return "disabled";
  } catch (_error) { /* The sandbox may be unable to query the unit. */ }
  return "unavailable";
}
