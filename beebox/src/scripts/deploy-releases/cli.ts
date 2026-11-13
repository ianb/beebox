// Production releases: each deploy installs a complete tree beside the live
// one, then `/opt/beebox` (a symlink) switches to it in one rename.
//
//   node cli.ts prepare --install-dir D --stage S --name N -- <member>...
//   node cli.ts switch --install-dir D --to <release>
//   node cli.ts rollback --install-dir D --boxes-root B [--from <release>] [--check]
//   node cli.ts status --install-dir D
//
// Layout: releases live in `<D>.releases/<name>`; `<D>.releases/previous`
// links to the release the last switch replaced, the rollback target. The
// first switch on a host whose `<D>` is still a real directory moves that
// tree to `<D>.releases/legacy-<stamp>`. Pruning keeps the live and previous
// releases only. A release an earlier rollback left carries `FAILED_MARK`
// and is never a rollback target.
//
// deploy.sh installs this file as root from the build checkout and runs it
// with Node's type stripping, so it imports Node built-ins only. The plan is
// docs/implemented-plans/atomic-deploy.md.
import * as fs from "node:fs";
import { parseArgs } from "node:util";
import { ReleaseRefusedError, layoutFor, liveRelease, previousRelease, realOrNull, switchRelease } from "./layout.ts";
import { PNPM_INSTALL, prepareRelease } from "./prepare.ts";
import { decideRollback, rollbackRelease } from "./rollback.ts";

function run(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      "install-dir": { type: "string" }, stage: { type: "string" }, name: { type: "string" },
      to: { type: "string" }, from: { type: "string" }, check: { type: "boolean" },
      "boxes-root": { type: "string" },
    },
  });
  const [command, ...members] = positionals;
  const installDir = values["install-dir"];
  if (installDir === undefined) throw new ReleaseRefusedError({ kind: "usage", command });
  const layout = layoutFor(installDir);
  if (command === "prepare") {
    if (values.stage === undefined || values.name === undefined) throw new ReleaseRefusedError({ kind: "usage", command });
    console.log(prepareRelease(layout, { stage: values.stage, name: values.name, members, install: PNPM_INSTALL }));
  } else if (command === "switch") {
    if (values.to === undefined) throw new ReleaseRefusedError({ kind: "usage", command });
    const from = switchRelease(layout, values.to);
    console.log(`  live release: ${fs.realpathSync(layout.installDir)} (was ${from ?? "none"})`);
  } else if (command === "rollback") {
    const boxesRoot = values["boxes-root"];
    if (boxesRoot === undefined) throw new ReleaseRefusedError({ kind: "usage", command });
    const options = { expectedFrom: values.from ?? null, boxesRoot };
    if (values.check === true) {
      const decision = decideRollback(layout, options);
      if (!decision.ok) throw new ReleaseRefusedError({ kind: "rollback", reason: decision.reason });
      console.log(decision.to);
    } else {
      const { from, to } = rollbackRelease(layout, options);
      console.log(`  rolled back: ${to} is live; ${from} is marked failed`);
    }
  } else if (command === "status") {
    console.log(`live: ${liveRelease(layout) ?? `(not a release link: ${layout.installDir})`}`);
    console.log(`previous: ${previousRelease(layout) ?? "(none)"}`);
  } else {
    throw new ReleaseRefusedError({ kind: "usage", command });
  }
}

if (process.argv[1] !== undefined && import.meta.filename === realOrNull(process.argv[1])) {
  try {
    run(process.argv.slice(2));
  } catch (e) {
    console.error(`bbx-release: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = e instanceof ReleaseRefusedError ? 3 : 1;
  }
}
