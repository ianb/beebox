export interface MovedCardRecovery {
  kind: "moved";
  path: string;
}

export class MovedCardRecoveryCauseError extends Error {
  readonly recovery: MovedCardRecovery;

  constructor(path: string) {
    super(`Card moved to ${path}`);
    this.name = "MovedCardRecoveryCauseError";
    this.recovery = { kind: "moved", path };
  }
}

export function movedCardRecoveryFromCause(cause: unknown): MovedCardRecovery | null {
  return cause instanceof MovedCardRecoveryCauseError ? cause.recovery : null;
}
