/**
 * The per-user state directory — `~/.local/share/cb`.
 *
 * Machine state that belongs to the person rather than to any one box: the
 * scheduler's logs, the push-subscription store, engine availability, the
 * machine's origin id. Defined once here so those stores cannot drift onto
 * different paths; each still names its own file (and its own env override)
 * beneath it.
 */

import * as os from "node:os";
import * as path from "node:path";

export const CB_STATE_DIR = path.join(os.homedir(), ".local/share/cb");
