import type { BroadcastEventFn } from "../routes/sse.js";
import type { Services } from "../../services/index.js";

export interface TrpcContext {
  boxRoot: string;
  broadcastEvent: BroadcastEventFn;
  services: Services;
}
