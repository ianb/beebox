/**
 * External converters available on the box host.
 *
 * (Chat-only surfaces — file attachments and document selections — live in the
 * chat system prompt, not this always-loaded guide, since the reactor and
 * procedure agents never see them. Custom views moved to the on-demand `views`
 * skill.)
 */

export function externalToolsSection(): string {
  return `## External Tools

Always available on the box host, reach for them directly: \`pandoc\` (document conversion — .doc/.docx/.rtf/.odt → text or markdown), \`imagemagick\` (\`magick\`), \`poppler-utils\` (\`pdftotext\`, \`pdfimages\`), and for spreadsheets \`xlsx2csv\` (\`.xlsx\` → CSV) or the \`openpyxl\` Python library (\`.xlsx\` only — legacy \`.xls\` is not supported). Box-specific Python CLIs: \`_content/docs/generated/python-tools.md\`.`;
}
