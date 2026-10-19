// SDK steering probe verdicts: a timeout is inconclusive with its own exit
// status, and only a lost or misrouted steer message reads as a behavior change.

import { test } from "tap";
import { classify, exitStatus, type Observation } from "../../../src/scripts/sdk-steering-probe/verdict.js";

const obs = (turnsBeforeSteerAnswer: number | null, timedOut: boolean): Observation => ({ turnsBeforeSteerAnswer, resultCount: 1, timedOut });

void test("each observation maps to one outcome", (t) => {
  t.check(
    [
      classify(true, obs(0, false)),
      classify(false, obs(1, false)),
      classify(true, obs(null, true)),
      classify(false, obs(null, false)),
      classify(true, obs(1, false)),
      // An answer in the wrong turn is a behavior change even if the deadline also fired.
      classify(true, obs(1, true)),
    ],
    [
      { kind: "pass" },
      { kind: "pass" },
      { kind: "inconclusive", reason: "timed out before the steer answer arrived" },
      { kind: "fail", reason: "steer message was LOST (never answered)" },
      { kind: "fail", reason: "expected same-turn injection, but the answer came 1 turn(s) later" },
      { kind: "fail", reason: "expected same-turn injection, but the answer came 1 turn(s) later" },
    ],
  );
  t.end();
});

void test("a behavior change outranks an inconclusive scenario in the exit status", (t) => {
  const pass = { kind: "pass" } as const;
  const fail = { kind: "fail", reason: "lost" } as const;
  const inconclusive = { kind: "inconclusive", reason: "timed out" } as const;
  t.check(
    [exitStatus([pass, pass]), exitStatus([pass, inconclusive]), exitStatus([inconclusive, fail]), exitStatus([])],
    [0, 2, 1, 0],
  );
  t.end();
});
