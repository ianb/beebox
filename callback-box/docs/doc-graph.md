# Documentation Graph Report

Generated: 2026-03-05T05:31:10Z
Total documents: 33

## Issues

### Orphaned Documents (no incoming references)

These documents are not referenced by any other document.

- **deploy/CLAUDE.md** — "Deploy" (9 lines)

## Document Inventory

### ./

#### CLAUDE.md

Title: "Callback Box" | 146 lines

Referenced by:
- CONVENTIONS.md:3 (mention) — Add these to your project's CLAUDE.md (or equivalent AI assistant instructions).
- docs/EXAMPLE_FILES.md:50 (mention) — ├── CLAUDE.md
- docs/IMPLEMENTATION.md:668 (mention) — CLAUDE.md              # Base instructions for all agents
- docs/adding-schemas.md:174 (mention) — 5. The agent guide is `@`-included in `CLAUDE.md`, so agents always see the card type list
- docs/agent-knowledge.md:7 (mention) — 1. **Knows directly** — Can answer without investigation. The information is directly in the agent's loaded context: `CL
- docs/ideas.md:9 (mention) — - Custom subagents don't inherit CLAUDE.md or `.claude/rules/` (only built-in subagents do)
- docs/prompt-logging.md:3 (mention) — When agents run in a callback box (via `cb wakeup`, `cb process-news`, procedures, etc.), you can capture the full API t
- docs/testing-gaps.md:94 (mention) — - **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DE

References:
- → docs/DESIGN.md (mention)
- → docs/IMPLEMENTATION.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/procedure-implementation.md (mention)
- → docs/testing.md (mention)
- → docs/testing-gaps.md (mention)
- → docs/connectors.md (mention)
- → docs/scheduler.md (mention)
- → docs/adding-schemas.md (mention)
- → docs/agent-knowledge.md (mention)
- → docs/stack-decisions.md (mention)
- → docs/state-management-comparison.md (mention)
- → docs/design-card-views.md (mention)
- → docs/prompt-logging.md (mention)
- → docs/telegram-setup.md (mention)
- → docs/gmail-setup.md (mention)
- → docs/google-setup.md (mention)
- → docs/ideas.md (mention)
- → docs/adding-api-endpoints.md (mention)
- → docs/TESTING-NEWS-PROCEDURE.md (mention)
- → docs/doc-graph.md (mention)
- → src/services/CLAUDE.md (mention)
- → src/connectors/CLAUDE.md (mention)
- → src/test-lib/docs/getting-started.md (mention)
- → src/test-lib/docs/check-reference.md (mention)
- → CONVENTIONS.md (at-include)

#### CONVENTIONS.md

Title: "Coding Conventions" | 60 lines

Referenced by:
- CLAUDE.md:145 (at-include) — @CONVENTIONS.md

References:
- → CLAUDE.md (mention)

#### README.md

Title: "callback-box" | 2 lines

Referenced by:
- docs/design-card-views.md:47 (mention) — README.md               → [Source]

#### THINKING_CLAUDE.md

Title: "Thinking Machine Mode" | 93 lines

Referenced by:
- docs/prompt-logging.md:81 (mention) — Contents of /Users/.../THINKING_CLAUDE.md (project instructions, checked into the codebase):

### deploy/

#### deploy/CLAUDE.md **[ORPHAN]**

Title: "Deploy" | 9 lines

References:
- → deploy/README.md (mention)

#### deploy/README.md

Title: "Deploy" | 184 lines

Referenced by:
- deploy/CLAUDE.md:3 (mention) — Server provisioning and deployment scripts for Hetzner cloud. See `deploy/README.md` for full setup guide.

### docs/

#### docs/adding-api-endpoints.md

Title: "Adding API Endpoints" | 247 lines

Referenced by:
- CLAUDE.md:118 (mention) — | docs/adding-api-endpoints.md | How to add new tRPC API endpoints |

#### docs/adding-schemas.md

Title: "Adding a New Card Schema" | 187 lines

Referenced by:
- CLAUDE.md:108 (mention) — | docs/adding-schemas.md | How to add a new card type with Zod schema |

References:
- → CLAUDE.md (mention)

#### docs/agent-knowledge.md

Title: "Agent Knowledge Audit: What It Should Know and How to Verify" | 432 lines

Referenced by:
- CLAUDE.md:109 (mention) — | docs/agent-knowledge.md | Knowledge taxonomy and audit test design |
- docs/testing.md:394 (link) — See [agent-knowledge.md](agent-knowledge.md) for the full knowledge taxonomy and test prompt guide.

References:
- → CLAUDE.md (mention)
- → docs/connectors.md (mention)

#### docs/connectors.md

Title: "Connectors" | 91 lines

Referenced by:
- CLAUDE.md:106 (mention) — | docs/connectors.md | Connector architecture, inventory, service injection, writing new connectors |
- docs/agent-knowledge.md:205 (mention) — - **Expected level: Discoverable** — the agent would need to look at `config/connectors/` and/or `docs/generated/connect

References:
- → src/services/CLAUDE.md (mention)

#### docs/design-card-views.md

Title: "Card View Plugin System" | 936 lines

Referenced by:
- CLAUDE.md:112 (mention) — | docs/design-card-views.md | Card view plugin system: pluggable renderers, directory browsing, validated patches |

References:
- → README.md (mention)

#### docs/DESIGN.md

Title: "Callback Box: comprehensive design notes" | 528 lines

Referenced by:
- CLAUDE.md:15 (mention) — See `docs/DESIGN.md` for detailed rationale. Summary:
- docs/IMPLEMENTATION.md:5 (mention) — This document describes how to build Callback Box, complementing DESIGN.md with concrete implementation details.
- docs/testing-gaps.md:94 (mention) — - **2026-03-03:** Reactor restructured from single 680-line file into `src/core/reactor/` directory (9 source files + DE

#### docs/doc-graph.md

Title: "(no title)" | 1 lines

Referenced by:
- CLAUDE.md:120 (mention) — | docs/doc-graph.md | Auto-generated documentation cross-reference report |

#### docs/EXAMPLE_FILES.md

Title: "Callback Box: Example Files" | 815 lines

Referenced by:
- CLAUDE.md:102 (mention) — | docs/EXAMPLE_FILES.md | Concrete examples of cards, schemas, CLI usage |
- docs/IMPLEMENTATION.md:225 (mention) — See EXAMPLE_FILES.md for RRULE examples and other card/schema samples.
- docs/IMPLEMENTATION.md:274 (link) — Config includes credential references, polling intervals, filters, etc. Agents can read these to understand what's avail

References:
- → CLAUDE.md (mention)

#### docs/gmail-setup.md

Title: "Gmail Connector Setup" | 101 lines

Referenced by:
- CLAUDE.md:115 (mention) — | docs/gmail-setup.md | Gmail IMAP setup guide |

#### docs/google-setup.md

Title: "Google Cloud Console Setup" | 111 lines

Referenced by:
- CLAUDE.md:116 (mention) — | docs/google-setup.md | Google OAuth/API setup guide |

#### docs/ideas.md

Title: "Ideas & Planned Features" | 52 lines

Referenced by:
- CLAUDE.md:117 (mention) — | docs/ideas.md | Feature ideas and backlog |

References:
- → CLAUDE.md (mention)

#### docs/IMPLEMENTATION.md

Title: "Callback Box: Implementation Guide" | 1027 lines

Referenced by:
- CLAUDE.md:101 (mention) — | docs/IMPLEMENTATION.md | Technical implementation guide—*how* to build it |

References:
- → docs/DESIGN.md (mention)
- → docs/EXAMPLE_FILES.md (mention)
- → docs/EXAMPLE_FILES.md (link)
- → CLAUDE.md (mention)

#### docs/procedure-implementation.md

Title: "Procedures" | 133 lines

Referenced by:
- CLAUDE.md:103 (mention) — | docs/procedure-implementation.md | Procedure engine: definitions, runs, steps, validation, CLI usage |

#### docs/prompt-logging.md

Title: "Prompt Logging for Agent Invocations" | 212 lines

Referenced by:
- CLAUDE.md:113 (mention) — | docs/prompt-logging.md | Capturing and debugging agent API traffic (system prompts, loaded context) |

References:
- → CLAUDE.md (mention)
- → THINKING_CLAUDE.md (mention)

#### docs/scheduler.md

Title: "Scheduler" | 93 lines

Referenced by:
- CLAUDE.md:107 (mention) — | docs/scheduler.md | Background tick daemon: launchd/systemd setup, multi-box scheduling |

#### docs/stack-decisions.md

Title: "Stack Decisions" | 1108 lines

Referenced by:
- CLAUDE.md:110 (mention) — | docs/stack-decisions.md | Technology choices and rationale |

References:
- → docs/state-management-comparison.md (mention)
- → docs/testing-gaps.md (mention)

#### docs/state-management-comparison.md

Title: "State Management Comparison: Zustand vs MobX-State-Tree vs Valtio vs XState" | 831 lines

Referenced by:
- CLAUDE.md:111 (mention) — | docs/state-management-comparison.md | Frontend state management options analysis |
- docs/stack-decisions.md:157 (mention) — Evaluation prototypes (history-xstate.ts, HistoryPageXState.tsx, state-fixtures.ts, render-page.tsx) have been deleted. 

#### docs/telegram-setup.md

Title: "Telegram Connector Setup" | 136 lines

Referenced by:
- CLAUDE.md:114 (mention) — | docs/telegram-setup.md | Telegram bot setup guide |

#### docs/testing-gaps.md

Title: "Testing Gaps — Working Document" | 96 lines

Referenced by:
- CLAUDE.md:105 (mention) — | docs/testing-gaps.md | Working document: coverage status, what's tested, what's not |
- docs/stack-decisions.md:803 (mention) — Core doctest system is **done** and working well. 931 tests across 53 files. See `docs/testing-gaps.md` for detailed cov
- docs/testing.md:458 (link) — See [testing-gaps.md](testing-gaps.md) for detailed plans. Key ideas:

References:
- → docs/DESIGN.md (mention)
- → CLAUDE.md (mention)

#### docs/TESTING-NEWS-PROCEDURE.md

Title: "Testing the News Procedure" | 264 lines

Referenced by:
- CLAUDE.md:119 (mention) — | docs/TESTING-NEWS-PROCEDURE.md | Step-by-step walkthrough: testing news processing end-to-end |

#### docs/testing.md

Title: "Testing" | 464 lines

Referenced by:
- CLAUDE.md:104 (mention) — | docs/testing.md | Testing philosophy, doctests, scenarios, knowledge audits, service fakes |

References:
- → src/services/CLAUDE.md (mention)
- → docs/agent-knowledge.md (link)
- → docs/testing-gaps.md (link)

### src/connectors/

#### src/connectors/CLAUDE.md

Title: "Connectors" | 33 lines

Referenced by:
- CLAUDE.md:132 (mention) — Connectors sync external services with the box filesystem. Each implements `Connector.sync()` — pull data in, optionally

References:
- → src/services/CLAUDE.md (mention)

### src/core/reactor/

#### src/core/reactor/CLAUDE.md

Title: "Reactor" | 24 lines

Referenced by:
- src/core/reactor/DESIGN.md:71 (mention) — - **System prompt** tells the agent what context it already has (job XML, referenced files, schema instructions, rules f

References:
- → src/core/reactor/DESIGN.md (link)

#### src/core/reactor/DESIGN.md

Title: "Reactor Design" | 116 lines

Referenced by:
- src/core/reactor/CLAUDE.md:3 (link) — See [DESIGN.md](DESIGN.md) for the full architecture, flow, and rationale.

References:
- → src/core/reactor/CLAUDE.md (mention)

### src/services/

#### src/services/CLAUDE.md

Title: "Services" | 125 lines

Referenced by:
- CLAUDE.md:126 (mention) — Every external dependency (API, library, CLI tool) is wrapped in a typed service interface with three parts: an interfac
- docs/connectors.md:72 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation.
- docs/testing.md:126 (mention) — External dependencies (APIs, CLIs) are wrapped in typed service interfaces with fake implementations for testing. Full s
- src/connectors/CLAUDE.md:16 (mention) — See `src/services/CLAUDE.md` for the full service layer documentation: interfaces, fakes, call logging, and testing patt

### src/test-lib/docs/

#### src/test-lib/docs/check-reference.md

Title: "check() — String-comparison testing primitive" | 356 lines

Referenced by:
- CLAUDE.md:143 (mention) — Use `t.check(actual, expected)` for string comparisons with wildcards (`«date»`, `«*»`, etc.). Start with `src/test-lib/
- src/test-lib/docs/getting-started.md:76 (link) — See [check-reference.md](check-reference.md) for:

#### src/test-lib/docs/getting-started.md

Title: "Testing with check()" | 83 lines

Referenced by:
- CLAUDE.md:143 (mention) — Use `t.check(actual, expected)` for string comparisons with wildcards (`«date»`, `«*»`, etc.). Start with `src/test-lib/

References:
- → src/test-lib/docs/check-reference.md (link)

