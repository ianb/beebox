import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBody } from "./render.js";
import { twinMarkdown } from "./build.js";

const context = { file: "cards/index.site-page.card", pageSitePath: "index.site-page.card", base: "/" };
const body = '{% agent-prompt title="Install Bee Box" id="install" %}\n```\nRead the guide. Ask before changing my machine.\n```\n{% /agent-prompt %}';

test("agent prompts are addressable, escaped, selectable and have a dedicated copy action", () => {
  const rendered = renderBody(body, context);
  assert.match(rendered.html, /class="agent-prompt" id="install" aria-labelledby="install-title"/);
  assert.match(rendered.html, /<code>Read the guide\. Ask before changing my machine\.\n<\/code>/);
  assert.match(rendered.html, /aria-label="Copy prompt: Install Bee Box"/);
  assert.match(rendered.html, /role="status"/);
  assert.match(renderBody(body.replace("Read the guide.", "Read <guide> & ask."), context).html, /Read &lt;guide&gt; &amp; ask/);
});

test("empty and ambiguous prompt bodies fail rather than copying unintended text", () => {
  assert.throws(() => renderBody(body.replace("Read the guide. Ask before changing my machine.", ""), context), /nonempty fenced prompt/);
  assert.throws(() => renderBody(body.replace("```\nRead", "Explanation.\n\n```\nRead"), context), /exactly one/);
});

test("the machine-facing twin preserves prompt text and fences", () => {
  const twin = twinMarkdown(body, { nuggets: [], asides: new Map() });
  assert.equal(twin, "```\nRead the guide. Ask before changing my machine.\n```\n");
});
