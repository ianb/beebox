import type { EventBus } from "../../core/event-bus.js";
import type { Services } from "../../services/index.js";

export interface TrpcContext {
  boxRoot: string;
  boxSlug: string;
  eventBus: EventBus;
  services: Services;
}
