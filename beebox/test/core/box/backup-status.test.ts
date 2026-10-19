// # Backup status
//
// What of a box exists anywhere but this machine. The two pure pieces are tested
// here; the git and filesystem gathering around them needs a real repo.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  parseCountObjects,
  assessAssetRisk,
  isOffsiteRemoteUrl,
} from "../../../src/core/box/backup-status.js";

// ## Repo size comes out of `git count-objects -vH`
//
// `-H` is the only form that reports pack size, so it hands back human units that
// have to be multiplied out. Loose objects (`size`) and packs (`size-pack`) both
// count; the other keys are counts, not bytes, and must not be summed in.
void test("-H is the only form that reports pack size, so it hands back human units that...", async (t) => {
  const output = [
    "count: 42",
    "size: 5.22 MiB",
    "in-pack: 13500",
    "packs: 2",
    "size-pack: 133.62 MiB",
    "prune-packable: 0",
    "garbage: 0",
    "size-garbage: 0 bytes",
  ].join("\n");
  t.check(parseCountObjects(output), 145584292);
});

// A box whose objects are all loose reports no `size-pack` line at all.
void test("A box whose objects are all loose reports no size-pack line at all.", async (t) => {
  t.check(parseCountObjects("count: 3\nsize: 12.00 KiB"), 12288);
});

// Unparseable or empty output is zero rather than `NaN` — a size we could not
// measure must not reach the page as "NaN bytes at risk".
void test("Unparseable or empty output is zero rather than NaN — a size we could not mea...", async (t) => {
  t.check(parseCountObjects(""), 0);

  t.check(parseCountObjects("size: not-a-number MiB\nsize-pack: 4 QiB"), 0);
});

// ## Asset risk distinguishes "no annex remote" from "not tracked at all"
//
// These are different problems and a boxholder has to tell them apart. An annexed
// box with no annex-capable remote has its filenames on GitHub and its bytes only
// here — pushing harder will never move them.
void test("These are different problems and a boxholder has to tell them apart.", async (t) => {
  t.check(
    assessAssetRisk({
      annex: { bytes: 10100000000, fileCount: 3026 },
      annexRemoteConfigured: false,
      untrackedAssets: { bytes: 0, fileCount: 0 },
    }),
    {
    reason: "no-annex-remote",
    bytes: 10100000000,
    fileCount: 3026,
  },
  );
});

// Give that same box a remote git-annex can send content to and there is nothing
// to warn about.
void test("Give that same box a remote git-annex can send content to and there is nothin...", async (t) => {
  t.check(
    assessAssetRisk({
      annex: { bytes: 10100000000, fileCount: 3026 },
      annexRemoteConfigured: true,
      untrackedAssets: { bytes: 0, fileCount: 0 },
    }),
    null,
  );
});

// A box with no annex is the worse case: its `*.attach/` payloads are gitignored,
// so git holds not even a pointer to them.
void test("A box with no annex is the worse case:", async (t) => {
  t.check(
    assessAssetRisk({
      annex: null,
      annexRemoteConfigured: false,
      untrackedAssets: { bytes: 369098752, fileCount: 1072 },
    }),
    {
    reason: "not-tracked",
    bytes: 369098752,
    fileCount: 1072,
  },
  );
});

// An annexed box holding no assets yet is not at risk, even with no annex remote
// — there is nothing to strand, and warning anyway trains the boxholder to ignore
// the warning.
void test("An annexed box holding no assets yet is not at risk, even with no annex remot...", async (t) => {
  t.check(
    assessAssetRisk({
      annex: { bytes: 0, fileCount: 0 },
      annexRemoteConfigured: false,
      untrackedAssets: { bytes: 0, fileCount: 0 },
    }),
    null,
  );
});

// Same for a box with neither an annex nor any attachments — a fresh box is
// quiet, not warned at.
void test("Same for a box with neither an annex nor any attachments — a fresh box is qui...", async (t) => {
  t.check(
    assessAssetRisk({
      annex: null,
      annexRemoteConfigured: false,
      untrackedAssets: { bytes: 0, fileCount: 0 },
    }),
    null,
  );
});

// ## "Offsite" means a different machine, not merely a different directory
//
// git-annex will treat a sibling clone at a local path as a content remote, and
// for its purposes that is right — the bytes really are reachable. For a backup
// it is not: a local path dies with the disk. So only a remote naming a host
// counts.
void test("git-annex will treat a sibling clone at a local path as a content remote, and...", async (t) => {
  t.check(isOffsiteRemoteUrl("git@github.com-box-hearth:marlowe/box-hearth.git"), true);

  t.check(
    isOffsiteRemoteUrl("https://github.com/marlowe/box-hearth.git")
    ,
    true,
  );

  t.check(
    isOffsiteRemoteUrl("ssh://git@example.com/srv/box.git")
    ,
    true,
  );
});

// A path on this machine does not, in any of the forms git accepts for one.
void test("A path on this machine does not, in any of the forms git accepts for one.", async (t) => {
  t.check(isOffsiteRemoteUrl("/Users/me/src/boxes/hearth"), false);

  t.check(isOffsiteRemoteUrl("../sibling-box"), false);

  t.check(
    isOffsiteRemoteUrl("file:///Users/me/src/boxes/hearth")
    ,
    false,
  );

  t.check(isOffsiteRemoteUrl(""), false);
});

// Git accepts scp-like remotes without a user, so `host:path` has to count too —
// requiring `user@` classified a perfectly real remote as a local path.
void test("Git accepts scp-like remotes without a user, so host:path has to count too —...", async (t) => {
  t.check(isOffsiteRemoteUrl("github.com:marlowe/box-hearth.git"), true);

  t.check(
    isOffsiteRemoteUrl("ssh://git@example.com:2222/srv/box.git")
    ,
    true,
  );
});

// A loopback host is this machine wearing a hostname, and counting it as offsite
// would be the same false comfort as a local path.
void test("A loopback host is this machine wearing a hostname, and counting it as offsit...", async (t) => {
  t.check(
    isOffsiteRemoteUrl("ssh://localhost/srv/box.git")
    ,
    false,
  );

  t.check(isOffsiteRemoteUrl("git@localhost:box.git"), false);

  t.check(
    isOffsiteRemoteUrl("ssh://127.0.0.1/srv/box.git")
    ,
    false,
  );
});

// A colon that is part of a path, not a host separator, is not a remote host.
void test("A colon that is part of a path, not a host separator, is not a remote host.", async (t) => {
  t.check(isOffsiteRemoteUrl("/srv/git:mirror/box.git"), false);
});
