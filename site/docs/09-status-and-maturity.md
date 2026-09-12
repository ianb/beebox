---
description: "Bee Box's license, maintainer, soft-launch status, update story, and where discussion happens."
---
# Status and maturity

**Early, and deliberately not promoted.** The project describes itself as not
yet public: the repository is open to look at, and the audience is the
maintainer's own network, invited to run it rather than to read about it. A
coding-agent subscription is treated as an audience filter rather than a gap.
Expect things to change without notice.

**One maintainer.** The project has a single maintainer, Ian Bicking. Bug
reports are invited. Pull requests and feature contributions are not
solicited. Some documentation is agent-written and human-reviewed, and says
so.

**License.** GPLv3 covers Bee Box, the Chrome extension, and the browse
wrapper. Two packages in the same repository are MIT-licensed for standalone
reuse: the doctest framework and the shared lint preset. The engine version
in the package metadata is `0.1.0`.

**How updates work.** `main` is the only release channel, so every commit is
implicitly shipped; there are no tags, versions, or changelog today. Updating
means pulling the repository and rebuilding the container or reinstalling
from source. Your **box**, the directory holding your data, is untouched by a
rebuild. On start the container runs a card-data migration sweep and
refreshes the box's generated agent docs, committing each migration it
applies to your box's git history, and stopping at a migration that needs a
human. The project's own records name the missing part: nothing tells an
operator that an update exists or what changed in it. Release discipline and
an update story are recorded as open work rather than shipped behavior.

**Security posture is documented rather than assumed.** The security overview
is agent-maintained and human-reviewed, with the rubric that generates it
committed in the repository, and it leads with blast radius. The issue queue
ships with the repository, including known bugs and accepted risks.

**Where to look and ask.**

- Source: [github.com/ianb/beebox](https://github.com/ianb/beebox)
- Discussion: [the Bee Box Discord server](https://discord.gg/FQYn6zyv)

See also [what it requires](06-what-it-requires.md) and
[your data and safety](08-your-data-and-safety.md).
