# Every shipped procedure template parses, and migration procedures have a gate

A procedure card that does not parse is not a broken test — it is a box that
stops serving. `trick-secret-runtime` shipped with no closing frontmatter
delimiter and a `whys:` key indented into its sibling's list, so
`parseProcedureDefinition` returned null, `assertProcedureHasGate` refused the
migration, and the unattended sweep left every production box closed for
migration. Three deploys failed that way before anyone read the stack trace.

Nothing checked these files. The templates ship to every box, and a procedure
registered as a migration is load-bearing in a path no one runs by hand.

```ts setup
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseProcedureDefinition } from "../../../src/schemas/procedure.js";
import { MIGRATIONS, isProcedureMigration } from "../../../src/core/migrations.js";
import { PACKAGE_ROOT } from "../../../src/lib/package-root.js";

const dir = join(PACKAGE_ROOT, "templates/procedures");
const names = readdirSync(dir).filter((n) => n.endsWith(".procedure.card"));
const definitions = new Map(
  names.map((n) => [n.replace(".procedure.card", ""), parseProcedureDefinition(readFileSync(join(dir, n), "utf8"))]),
);

const unparseable = [...definitions].filter(([, def]) => def === null).map(([name]) => name).sort();

// A procedure used as a migration needs a hard gate, or `bbx engine migrate`
// would record it applied on the strength of an agent saying so
// (cli/commands/migrate.ts, assertProcedureHasGate).
function hasAbortGate(name: string): boolean {
  const def = definitions.get(name);
  return def?.steps.some((s) => s.validate?.severity === "abort" && (s.validate.shells?.length ?? 0) > 0) ?? false;
}

const migrationProcedures = MIGRATIONS.filter(isProcedureMigration).map((m) => m.procedure);
const missingTemplate = migrationProcedures.filter((p) => !definitions.has(p)).sort();
const ungated = migrationProcedures.filter((p) => definitions.has(p) && !hasAbortGate(p)).sort();
```

Every shipped template is valid frontmatter that satisfies the procedure schema:

```ts
unparseable
=> []
```

At least one template exists, so an empty directory cannot pass the check above
by vacuum:

```ts
names.length > 0
=> true
```

Every procedure named by the migration registry ships a template, and every one
of those carries an abort gate:

```ts
missingTemplate
=> []

ungated
=> []
```
