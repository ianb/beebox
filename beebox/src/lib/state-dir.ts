/**
 * The per-user state directory — `~/.local/share/beebox`.
 *
 * Machine state that belongs to the person rather than to any one box: the
 * scheduler's logs, the push-subscription store, engine availability, the
 * machine's origin id. Defined once here so those stores cannot drift onto
 * different paths; each still names its own file (and its own env override)
 * beneath it.
 */

import * as os from "node:os";
import * as path from "node:path";
import { LEGACY_CONFIG_DIR, LEGACY_STATE_DIR } from "./state-migration.js";

export const BBX_STATE_DIR = path.join(os.homedir(), ".local/share/beebox");
export const BBX_CONFIG_DIR = path.join(os.homedir(), ".config/beebox");
export { LEGACY_CONFIG_DIR, LEGACY_STATE_DIR };
