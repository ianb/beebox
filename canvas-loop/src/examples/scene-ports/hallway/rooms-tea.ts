// Every room, by id, in the order of intra-game's map: left to right, top to bottom.
// Port: only the Hallway is ported (scene spike, chunk 5).
import type { RoomSpec } from "./kit-tea.js";
import { HALLWAY } from "./room-hallway-tea.js";

export const ROOMS: readonly RoomSpec[] = [HALLWAY];
export const ROOM_IDS = ["hallway"] as const;
