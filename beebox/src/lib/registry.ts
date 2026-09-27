/**
 * The one way a set of interchangeable modules is enumerated.
 *
 * A set directory (`schemas/`, `cli/commands/`, `trpc/routers/`) holds one
 * member per child, and exactly one module in the directory's parent lists
 * them by calling `defineRegistry`. The call is also the declaration the
 * layout check reads: `directory` names the set, `entry` names the entry
 * module of a directory member, and `members` must be exactly the imports
 * from that directory. Rules: docs/plans/file-layout.md, rule 4.
 *
 * Two member forms. A list with a `key` function derives each key from the
 * member (`(command) => command.name()`); a record gives keys literally and
 * the layout check verifies each key is the member's file or directory
 * name. Either way a duplicate key throws here, at construction, so the
 * first import of a registry in any test or at server start catches it.
 *
 * `M` is always written out at the call site (`defineRegistry<Command>({...})`),
 * never left to infer: inferring it from a mismatched member list would
 * silently widen `M` to their union instead of catching the mismatch. The
 * `NoInfer<M>` wrapper on the parameter blocks that inference, so an
 * omitted `<M>` defaults to `never` and any real member fails to typecheck.
 */

export class DuplicateRegistryKeyError extends Error {
  readonly directory: string;
  readonly key: string;
  constructor(directory: string, key: string) {
    super(`registry ${directory}: duplicate key "${key}"`);
    this.name = "DuplicateRegistryKeyError";
    this.directory = directory;
    this.key = key;
  }
}

export interface Registry<M> {
  /** The set directory, as written in the declaration (`"./schemas"`). */
  readonly directory: string;
  /** Members in declared order when `ordered`, otherwise sorted by key. */
  readonly list: ReadonlyArray<M>;
  readonly byKey: ReadonlyMap<string, M>;
  get(key: string): M | undefined;
  keys(): string[];
}

interface RegistrySpecBase {
  directory: string;
  /** Entry module name for directory members (`"schema"` → `foo/schema.ts`). */
  entry?: string;
  /** True when the list's order is semantics; false sorts by key. */
  ordered: boolean;
}

export interface ListRegistrySpec<M> extends RegistrySpecBase {
  key: (member: M) => string;
  members: ReadonlyArray<M>;
}

export interface RecordRegistrySpec<M> extends RegistrySpecBase {
  members: Readonly<Record<string, M>>;
}

export type RegistrySpec<M> = ListRegistrySpec<M> | RecordRegistrySpec<M>;

function isListSpec<M>(spec: RegistrySpec<M>): spec is ListRegistrySpec<M> {
  return "key" in spec;
}

export function defineRegistry<M = never>(spec: RegistrySpec<NoInfer<M>>): Registry<M> {
  const entries: Array<[string, M]> = isListSpec(spec)
    ? spec.members.map((member) => [spec.key(member), member])
    : Object.entries(spec.members);
  const byKey = new Map<string, M>();
  for (const [key, member] of entries) {
    if (byKey.has(key)) throw new DuplicateRegistryKeyError(spec.directory, key);
    byKey.set(key, member);
  }
  if (!spec.ordered) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const list = Object.freeze(entries.map(([, member]) => member));
  return Object.freeze({
    directory: spec.directory,
    list,
    byKey,
    get: (key: string): M | undefined => byKey.get(key),
    keys: (): string[] => entries.map(([key]) => key),
  });
}
