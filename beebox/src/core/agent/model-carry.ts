/**
 * Per-agent model carry.
 *
 * A session's provider must not change mid-life: re-invocations that omit a
 * model (the commit-nudge retry is the shipped case — `core/agent/commit.ts`)
 * resume the SAME session, and a GLM transcript resumed without its model
 * would run against a different provider. So the model of the first
 * invocation is the model of every following one until a caller names another
 * explicitly (`docs/plans/box-glm-provider.md`, Track 3).
 */

/** Remembers the last explicit model; resolves omitted ones to it. */
export function createModelCarrier(): {
  resolve: (model: string | undefined) => string | undefined;
} {
  let last: string | undefined;
  return {
    resolve(model: string | undefined): string | undefined {
      if (model !== undefined) last = model;
      return model ?? last;
    },
  };
}
