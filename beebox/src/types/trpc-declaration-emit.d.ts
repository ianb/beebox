// Puts tRPC's `unstable-core-do-not-import` subpath in the program, so
// declaration emit can name the types a subscription router infers
// (`TrackedData`, `SubscriptionProcedure`). They live in a hashed internal
// chunk that only this subpath re-exports; without it, emitting the router's
// `.d.ts` fails with TS2742 ("cannot be named ... not portable").
export type {} from "@trpc/server/unstable-core-do-not-import";
