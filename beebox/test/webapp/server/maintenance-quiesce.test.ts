// # When the server may close chat runs for maintenance
//
// `decideChatQuiesce` (src/webapp/server/maintenance-quiesce.ts) is the
// one-second poll's rule. A turn always waits. A chat between turns with live
// background tasks waits too, unless the owner cannot defer and its wait has run
// out. The hourly sweep used to close such a chat and kill its subagents
// (`docs/plans/maintenance-live-tasks.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { decideChatQuiesce } from "../../../src/webapp/server/maintenance-quiesce.js";

const NOW = Date.parse("2026-11-02T18:12:15.000Z");
const idle = { busy: false, liveTasks: 0 };
const researching = { busy: false, liveTasks: 1 };
const turn = { busy: true, liveTasks: 0 };

void test("the poll waits for turns and live background tasks", (t) => {
  t.check({
    allIdle: decideChatQuiesce({ sessions: [idle, idle], endsBackgroundTasksAt: undefined, now: NOW }),
    turn: decideChatQuiesce({ sessions: [idle, turn], endsBackgroundTasksAt: undefined, now: NOW }),
    // A deferrable owner (the hourly sweep, an upgrade, a backup) never ends tasks.
    deferrable: decideChatQuiesce({ sessions: [idle, researching], endsBackgroundTasksAt: undefined, now: NOW }),
    // A deployment ends them once its wait has run out, and not before.
    deployWaiting: decideChatQuiesce({ sessions: [researching], endsBackgroundTasksAt: "2026-11-02T18:12:16.000Z", now: NOW }),
    deployDue: decideChatQuiesce({ sessions: [researching], endsBackgroundTasksAt: "2026-11-02T18:12:15.000Z", now: NOW }),
    // A turn in progress still waits past the deadline: the drain bounds it.
    deployTurn: decideChatQuiesce({ sessions: [researching, turn], endsBackgroundTasksAt: "2026-11-02T18:12:00.000Z", now: NOW }),
  }, {
    allIdle: { quiesce: true },
    turn: { quiesce: false, waitingFor: "turn" },
    deferrable: { quiesce: false, waitingFor: "background-tasks" },
    deployWaiting: { quiesce: false, waitingFor: "background-tasks" },
    deployDue: { quiesce: true },
    deployTurn: { quiesce: false, waitingFor: "turn" },
  });
  t.end();
});
