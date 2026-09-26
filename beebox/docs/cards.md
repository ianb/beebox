# Cards

The unit of everything a box holds: a `Name.type.card` file with YAML
frontmatter and, when its schema allows, a markdown body. One page per member.

## Members

| Member | What it covers |
|---|---|
| [Format](cards/format.md) | The file format: naming, frontmatter and body, the shared Markdoc tags, attachments, refs, and how validation applies. |
| [Schemas](cards/schemas.md) | Adding a card type: the schema file, its hooks, registration, templates, the generated instructions doc. |
| [Validation](cards/validation.md) | How `bbx validate` reaches agents and commits: the hooks and the canonical ref rewrite. |
| [Migrations](cards/migrations.md) | Changing cards already on disk: applying, the admission gate, writing a migrator, the registry. |

## Owned elsewhere

- Where cards live on disk: [box layout](box-layout.md).
- What each built-in card type means to a box agent: the generated `card-<type>.md` docs a box installs; sources are each schema's `instructions`.
- Rules for editing schemas: `src/schemas/CLAUDE.md`, the agent file beside them.
- Media that cards attach: [assets](assets.md).
