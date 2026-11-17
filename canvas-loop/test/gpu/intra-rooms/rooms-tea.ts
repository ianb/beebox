// Every room, by id, in the order of intra-game's map: left to right, top to bottom.
import type { RoomSpec } from "./kit-tea.js";
import { ACTIVITY_HUB } from "./room-activity-hub-tea.js";
import { ARCHIVE_CONSOLE } from "./room-archive-console-tea.js";
import { ARCHIVE_LOUNGE } from "./room-archive-lounge-tea.js";
import { ATRIUM } from "./room-atrium-tea.js";
import { FEEDBACK_BOOTH } from "./room-feedback-booth-tea.js";
import { FOYER } from "./room-foyer-tea.js";
import { HALLWAY } from "./room-hallway-tea.js";
import { ILL_FITTING_LOUNGE } from "./room-ill-fitting-lounge-tea.js";
import { INTAKE } from "./room-intake-tea.js";
import { JOYOUS_CAFE } from "./room-joyous-cafe-tea.js";
import { NURSERY } from "./room-nursery-tea.js";
import { QUIET_PLAZA } from "./room-quiet-plaza-tea.js";
import { REFLECTION_CHAMBER } from "./room-reflection-chamber-tea.js";
import { SOLITUDE_CUBES } from "./room-solitude-cubes-tea.js";
import { STATIC_GARDEN } from "./room-static-garden-tea.js";
import { TRANQUIL_POOL } from "./room-tranquil-pool-tea.js";
import { UTILITY_CLOSET } from "./room-utility-closet-tea.js";
import { WAITING_ROOM } from "./room-waiting-room-tea.js";
import { YELLOW_ROOM } from "./room-yellow-room-tea.js";
import { QUARTERS } from "./room-quarters-tea.js";

export const ROOMS: readonly RoomSpec[] = [INTAKE, FOYER, ATRIUM, HALLWAY, ARCHIVE_CONSOLE, ARCHIVE_LOUNGE, TRANQUIL_POOL, JOYOUS_CAFE, ACTIVITY_HUB, YELLOW_ROOM, SOLITUDE_CUBES, WAITING_ROOM, STATIC_GARDEN, ILL_FITTING_LOUNGE, FEEDBACK_BOOTH, QUIET_PLAZA, NURSERY, REFLECTION_CHAMBER, UTILITY_CLOSET, ...QUARTERS];
export const ROOM_IDS = ["intake", "foyer", "hollow-atrium", "hallway", "archive-console", "archive-lounge", "tranquil-pool", "joyous-cafe", "activity-hub", "yellow-room", "solitude-cubes", "waiting-room", "static-garden", "ill-fitting-lounge", "feedback-booth", "quiet-plaza", "nursery", "reflection-chamber", "utility-closet", "quarters-doug", "quarters-marta", "quarters-frida", "quarters-june", "quarters-lana", "quarters-harold", "quarters-greg", "quarters-milton", "quarters-gloria", "quarters-lily", "quarters-henry", "quarters-yours"] as const;
