# Guide index

One row per subject. A subject with several pages has a parent that lists
them; walk in from the parent. [Documentation organization](README.md) says
where new material goes and how it is named.

## Subjects with several pages

| Subject | Parent |
|---|---|
| Installing beebox: Docker, from source, with an agent | [install](install.md) |
| Testing: the verification instruments | [testing](testing.md) |
| Cards: format, schemas, validation, migrations | [cards](cards.md) |
| Connectors: the framework, Google auth, Calendar, Gmail, Drive, Telegram | [connectors](connectors.md) |
| Chat: sessions, history, schedules, review, quick chat, composer, scroll | [chat](chat.md) |
| Media: assets, image orientation, image transforms | [media](media.md) |
| The prompt surface: review, lenses, logging | [prompts](prompts.md) |
| How development happens: agent coding, workflow, technologies, maintenance | [development](development.md) |
| The production server: provisioning, configuration, deploying, boxes, operations, health checks | [server](server.md) |
| Design rationale, one small file per topic | [design](design/README.md) |
| Docs shipped to box agents | [box](box/), with the generated reference from `src/core/docs-gen/package-docs.ts` |
| Onboarding narrative | [architecture](architecture/) |
| Plans, implemented plans, unimplemented plans, reports | [plans](plans/README.md), `implemented-plans/`, `unimplemented-plans/`, `reports/` |

## Single-page subjects

| Subject | Page |
|---|---|
| Engineering principles | [engineering-principles](engineering-principles.md) |
| Module map: the shared-code directory boundary | [module-map](module-map.md) |
| Adding an API endpoint (tRPC by default) | [adding-api-endpoints](adding-api-endpoints.md) |
| Box layout: the on-disk shape of a box | [box-layout](box-layout.md) |
| Secrets: the machine-level store and grants | [secrets](secrets.md) |
| Procedures: multi-step workflows as cards | [procedure-implementation](procedure-implementation.md) |
| Scheduler: the `bbx tick` daemon | [scheduler](scheduler.md) |
| Event bus | [event-bus](event-bus.md) |
| Triage: the intake pipeline | [triage](triage.md) |
| Questions: the question subsystem | [questions](questions.md) |
| Landmarks: the navigation surface | [landmarks](landmarks.md) |
| Model policy: which engine and model a box thinks with | [model-policy](model-policy.md) |
| Publishing: the managed static-site publisher, operator side | [publishing](publishing.md) |
| Client debug log | [client-debug-log](client-debug-log.md) |
| Data-source tagging in the UI | [data-source-tagging](data-source-tagging.md) |
| Content-Security-Policy | [content-security-policy](content-security-policy.md) |
| Security overview, and the structured report behind it | [security-overview](security-overview.md), [security-report](security-report.md) |
| Mobile contract: what the native apps and a box agree on | [mobile-contract](mobile-contract.md) |
| Mobile parity: iOS versus Android | [mobile-parity](mobile-parity.md) |
| Scan upload wire contract | [scan-upload-contract](scan-upload-contract.md) |
| Deploy scripts, directory map | [deploy/README](../deploy/README.md) |
| Doctest syntax | [agent-doctest](../../agent-doctest/docs/syntax.md) |
| Glossary | [glossary](glossary.md) |
| Example names for docs and tests | [example-names](example-names.md) |
| Third-party asset attribution | [attribution](attribution.md) |
| Name history | [name-history](name-history.md) |
| Security TODOs, dissolved into the report and the issue queue | [todo-security](todo-security.md) |
| Feature ideas and open issues | [issues](../../issues) at the monorepo root |
| External-tool research | [research](../../research/CLAUDE.md) |
