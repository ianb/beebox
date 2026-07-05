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

Always available on the box host, reach for them directly: \`pandoc\` (document conversion — .doc/.docx/.rtf/.odt → text or markdown), \`imagemagick\` (\`magick\`), and \`poppler-utils\` (\`pdftotext\`, \`pdfimages\`). Box-specific Python CLIs: \`docs/generated/python-tools.md\`.`;
}
