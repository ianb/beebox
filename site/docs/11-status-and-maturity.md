---
description: "Bee Box's license, maintainer, soft-launch status, update story, and where discussion happens."
---
# Status and maturity

**Early, and deliberately not promoted.** The project describes itself as not
yet public: the source code is open to look at, and the audience is the
maintainer's own network, invited to run it rather than to read about it. A
coding-agent subscription is treated as an audience filter rather than a gap.
Expect things to change without notice.

**One maintainer.** The project has a single maintainer, Ian Bicking. Bug
reports are invited. Pull requests and feature contributions are not
solicited. Some documentation is agent-written and human-reviewed, and says
so.

**License.** GPLv3 covers Bee Box, the Chrome extension, and the browse
wrapper. Two parts of the same source code are MIT-licensed for standalone
reuse: the doctest framework and the shared lint preset. The engine is
internally tracked as version 0.1.0.

**How updates work.** There is only one continuously updated version of the
software; every change is shipped as soon as it's made, with no version
numbers or list of what changed in each update, today. Updating means
fetching the latest version of the project and rebuilding the container, or
reinstalling from source. Your **box**, the directory holding your data, is
untouched by a rebuild. When it starts, the container automatically updates
your existing cards (the files that hold your data) to match any changes in what a card type expects and refreshes the
reference material generated for the agent, recording each of those updates
in your box's history, and it stops to ask for your help at any update that
needs a decision only you can make. The project's own records name the
missing part: nothing tells an operator that an update exists or what
changed in it. Release discipline and an update story are recorded as open
work rather than shipped behavior.

**Security posture is documented rather than assumed.** The security overview
is agent-maintained and human-reviewed, with the rubric that generates it
kept in the project's source code alongside it, and it leads with how bad the
worst case is. The issue queue ships with the project's source code,
including known bugs and accepted risks.

**Where to look and ask.**

- Source: [github.com/ianb/beebox](https://github.com/ianb/beebox)
- Discussion: [the Bee Box Discord server](https://discord.gg/FQYn6zyv)

See also [what it requires](08-what-it-requires.md) and
[your data and safety](10-your-data-and-safety.md).
