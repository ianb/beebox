/**
 * Generate the python-tools reference documentation for agents.
 *
 * Emitted into the package docs as python-tools.md (docs-gen/package-docs.ts).
 * Covers the project convention for invoking Python CLI tools: use `uvx`
 * with a version pin at the call site rather than installing globally.
 */

export function generatePythonToolsDoc(): string {
  return `# Python Tools

Python CLI tools (docling, OCR utilities, document converters, etc.) are invoked through \`uvx\` — the Python analog of \`npx\`. Each invocation runs the tool in an isolated, cached environment with no global install.

## The Rule

**Always pin a version at the call site.** Without a pin, a fresh box or an evicted cache resolves to whatever is latest on PyPI that day, which breaks reproducibility silently.

\`\`\`bash
uvx docling@2.14.0 <args>
# or, for tools where the CLI name differs from the package name:
uvx --from 'docling==2.14.0' docling <args>
\`\`\`

## What Not To Do

- Don't \`pip install\` globally or into a shared venv — versions drift, environments collide.
- Don't add Python deps to \`package.json\` or a project-level \`requirements.txt\` just to call a CLI. Use that path only when you need to **import** the library in Python code (in which case it belongs in a real project venv, not a CLI invocation).
- Don't invoke \`uvx <tool>\` without a version — it works locally and surprises you later.

## When Multiple Scripts Use the Same Tool

If two or more callers need the same tool at the same version, lift the pin to a single constant near the call sites (e.g., a \`PYTHON_TOOLS\` map in a shared module) rather than duplicating the literal across files. Don't graduate to a central manifest until there's actual duplication.

## uv Itself

\`uv\` is the runtime that \`uvx\` belongs to. It must be installed on the host (\`curl -LsSf https://astral.sh/uv/install.sh | sh\`). The tool/package cache lives at \`~/.cache/uv\` and is shared across all invocations by the same user, so the first \`uvx docling@...\` pays the download cost and subsequent runs reuse the cached wheels.
`;
}
