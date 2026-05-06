import type { ActivityInstance } from "./ActivityInstance.js";
import type { ActivityMcpConfig } from "./types.js";

export abstract class ActivityMode<I extends ActivityInstance = ActivityInstance> {
  readonly isDefault: boolean = false;

  constructor(protected readonly instance: I) {}

  abstract systemPrompt(): string | Promise<string>;
  abstract available(): boolean | Promise<boolean>;

  mcpServer(): ActivityMcpConfig | null {
    return null;
  }
}

export type ModeConstructor<I extends ActivityInstance = ActivityInstance> = new (
  instance: I,
) => ActivityMode<I>;
