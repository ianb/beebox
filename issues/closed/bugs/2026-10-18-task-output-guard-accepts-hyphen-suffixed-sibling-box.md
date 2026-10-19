---
title: "The task-output read guard accepts a sibling box whose name extends this box's name with a hyphen"
workstream: flaky-tests
area: beebox
labels: [security, chat]
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-flaky-tests — cross-model review (codex gpt-6-sol) of the transcript-path fix
resolution: implemented
---

Closed 2026-10-19. The guard now requires the encoded cwd segment to equal exactly the encoding of the box root or of a landmark directory in the box's chat history; the route reads the history on each request. On the developer's machine, all 15 real task-output directories of the one box that had any matched that set. One collision remains, documented at the function: a landmark `alpha/other` and a sibling box `alpha-other` encode the same.


`isTaskOutputPathForBox` (`beebox/src/core/chat/session/transcript-paths.ts`)
guards `GET /api/task-output`. It accepts a task-output path when its encoded
cwd segment equals this box's encoded root or starts with that root plus `-`,
so that landmark subdirectories pass. The encoding turns every
non-alphanumeric character into `-`, so it loses information: for a box at
`/srv/boxes/alpha`, the encoded root is `-srv-boxes-alpha`, and the sibling
box `/srv/boxes/alpha-other` encodes to `-srv-boxes-alpha-other`, which
passes the `-` prefix test. The route's second check on the realpath uses the
same comparison, so a plain file in the sibling's task directory is readable.

The doc comment says the `-` rule rejects "an unrelated box whose encoded
root happens to start with the same characters"; that holds only when the
next character in the sibling's name is not punctuation.

The collision predates the 2026-10-18 symlink fix, which only changed which
root is encoded. That fix adds one new reach: a box served at an alias path
(`/aliases/alpha` linking to `/srv/boxes/alpha`) now encodes the resolved root,
so `/srv/boxes/alpha-other` collides where the alias encoding did not. Reach: a host with two boxes where one box's path is another's plus
a hyphen, dot, or underscore suffix, and a request to one box's server naming
the other's task file.

Smallest honest fix: compare against the set of cwds this box actually
authorizes (the box root and its landmark directories, each encoded) rather
than a prefix of the lossy encoding; or require the box's recorded session
ids, since the segment after the cwd is the session id.
