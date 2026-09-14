# Build stamp

What this uploader *is*, as opposed to what protocol it speaks. A bundle can be
current on the contract and still be missing features — it obeys the contract
but not well — and only a date shows that. The box records what it receives and
can report that an uploader is old.

These tests run under tsx from a checkout, so `buildStamp()` reports `source`
here. That is the honest answer rather than a gap in coverage: a checkout runs
current source on every sweep and cannot drift, so there is no build date to
report. Bundle mode is covered where it can be covered for real —
`smoke-install.sh` builds the bundle and asserts `--version` on it, since the
stamp only exists once esbuild's `define` has replaced it.

```ts setup
import { buildStamp, describeBuild, UNKNOWN_REVISION, type BuildStamp } from "../src/build-stamp.js";
```

## Source mode is reported as source, not as a fake build

```
JSON.stringify(buildStamp())
=> {"mode":"source"}
```

```continue
describeBuild(buildStamp())
=> running from source (a checkout — tracks current source)
```

## A bundle describes its revision and build time

The shape `build.ts` bakes in. Constructed directly here — the point under test
is the rendering, and the replacement itself belongs to the build.

```
const bundle: BuildStamp = { mode: "bundle", revision: "16e177c0", builtAt: "2026-09-14T18:46:01.243Z" };
describeBuild(bundle)
=> bundle 16e177c0, built 2026-09-14T18:46:01.243Z
```

A dirty build says so. This matters more than it looks: a bundle built from
uncommitted work is not the revision it names, and a box told a clean hash
would be told something false about the file it is talking to.

```continue
describeBuild({ mode: "bundle", revision: "16e177c0-dirty", builtAt: "2026-09-14T18:46:01.243Z" })
=> bundle 16e177c0-dirty, built 2026-09-14T18:46:01.243Z
```

## A build with no git tree still reports when it was built

A build from an exported tarball has no revision to name, but its build time is
still real — which is the half that answers "is this uploader old?", so the
stamp stays useful rather than degrading to nothing.

```continue
describeBuild({ mode: "bundle", revision: UNKNOWN_REVISION, builtAt: "2026-09-14T18:46:01.243Z" })
=> bundle unknown revision, built 2026-09-14T18:46:01.243Z
```
