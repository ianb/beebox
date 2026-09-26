# Installing beebox

Three ways to get a running beebox. Choose by what you want to do with it.

## Paths

| Path | For | Page |
|---|---|---|
| Docker | Running a box, locally or on a VPS, without touching the source. The image bakes in every host dependency. | [Docker](install/docker.md) |
| From source | Hacking on the engine itself. | [Developer](install/developer.md) |
| With an AI agent | A person who has asked their assistant to install it for them; the page is written for the assistant. | [Agent](install/agent.md) |

## What every path shares

- The engine and the box are separate. The box is the person's data, a git
  repository created by `bbx init`, wherever they choose to keep it.
- Claude authentication is subscription login (`claude auth login`);
  `ANTHROPIC_API_KEY` is ignored by design.
- Box login is on by default; the first account is the owner.
- The defaults are loopback-only. Exposing a box to a network is a decision
  the Docker page walks through.

## Owned elsewhere

- The one operator's multi-box production server is not an install path:
  [server](server.md).
- Google, Gmail, Drive, Calendar, and Telegram setup: their own pages,
  listed in the [guide index](guides.md).
