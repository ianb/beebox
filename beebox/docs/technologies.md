# Technologies and AI services

Part of [how development happens here](development-process.md). See also [agent
coding and the checks around it](agent-coding.md), [the development
workflow](development-workflow.md), and [testing](testing.md).

## Specific technologies

TypeScript throughout; JavaScript files exist only as thin loaders. Node 24 and
pnpm 10 workspaces across `beebox`, its frontend, `agent-doctest`,
`personal-vibe-check`, `workstreams-app`, `site`, and others.

The backend is Fastify 5 with tRPC 11, including WebSocket subscriptions; raw
Fastify routes are reserved for transports that do not fit tRPC. Zod 4 validates
untrusted boundaries. SQLite through `better-sqlite3` backs usage accounting,
the event bus, box packaging, and hub health. The frontend is React 18 with
Vite, TanStack Query and Router, XState 5, and Tailwind. Markdoc renders card
markdown. Tests run on tap, with `agent-doctest` layered on top.

Every box is a git repository, and its media is tracked with git-annex rather
than Git LFS: git holds a pointer, annex holds the bytes. A Dockerfile and
compose file cover the container install. The public site under `site/` is a
static Markdoc generator with no server-side anything and no external requests
at view time.

## AI services used

Beyond the coding agent, these are the only services box data leaves for, and
each is configured by the person running the box. Keys live in a machine-level
secrets store; a box gets access only when granted. The store and its grants are
documented in [secrets.md](secrets.md).

Transcription has four backends: OpenAI Whisper, Mistral's Voxtral, Deepgram,
and Microsoft's diarized service, the last reachable only through OpenRouter.
Text to speech uses OpenAI, or Gemini through OpenRouter. Search embeddings use
OpenAI. Scan and image understanding defaults to Claude, with a Gemini backend
available, and Gemini also handles audio questions. Google OAuth, Telegram, and
an R2 publish target are connector credentials rather than model services. The
repository configures image generation only for its own architecture
illustrations; it is not a product feature.

The box's own agent runs on one of two engines, Claude or Codex, pinned per box.
The model provider behind the coding agent therefore sees every agent turn.
