export class BundlePolicyError extends Error {
  readonly observed: number | undefined;
  readonly limit: number | undefined;

  constructor(details: { message: string; observed?: number; limit?: number }) {
    const { message, observed, limit } = details;
    super(message);
    this.name = "BundlePolicyError";
    this.observed = observed;
    this.limit = limit;
  }
}

export class ProjectCommandError extends Error {
  readonly step: "install" | "build";
  readonly timedOut: boolean;

  constructor(details: { step: "install" | "build"; timedOut: boolean; message: string }) {
    const { step, timedOut, message } = details;
    super(`${step} failed: ${message}`);
    this.name = "ProjectCommandError";
    this.step = step;
    this.timedOut = timedOut;
  }
}

/** Keep contextual detail formatting away from Error constructor callsites. */
export function bundlePolicyError(message: string, metadata?: { observed?: number; limit?: number }): BundlePolicyError {
  return new BundlePolicyError({ message, ...metadata });
}

export function projectCommandError(details: { step: "install" | "build"; timedOut: boolean; message: string }): ProjectCommandError {
  return new ProjectCommandError(details);
}
