import type { Activity } from "./Activity.js";

export class ActivityTypeAlreadyRegisteredError extends Error {
  constructor(public readonly type: string) {
    super(`Activity type already registered: ${type}`);
    this.name = "ActivityTypeAlreadyRegisteredError";
  }
}

export class UnknownActivityTypeError extends Error {
  constructor(public readonly type: string) {
    super(`Unknown activity type: ${type}`);
    this.name = "UnknownActivityTypeError";
  }
}

export class ActivityRegistry {
  private readonly activities = new Map<string, Activity>();

  register(activity: Activity): void {
    if (this.activities.has(activity.type)) {
      throw new ActivityTypeAlreadyRegisteredError(activity.type);
    }
    this.activities.set(activity.type, activity);
  }

  has(type: string): boolean {
    return this.activities.has(type);
  }

  get(type: string): Activity | undefined {
    return this.activities.get(type);
  }

  getOrThrow(type: string): Activity {
    const activity = this.activities.get(type);
    if (activity === undefined) throw new UnknownActivityTypeError(type);
    return activity;
  }

  list(): Activity[] {
    return Array.from(this.activities.values());
  }
}

/**
 * Built-in activity registry. Add new built-in activities here — box-local
 * activity loading is deferred until after the first real activity ships.
 */
export function createBuiltinRegistry(): ActivityRegistry {
  const registry = new ActivityRegistry();
  // register(new Polyglot()); — added when polyglot is ported
  return registry;
}
