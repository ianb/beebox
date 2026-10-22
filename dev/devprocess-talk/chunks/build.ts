// Renders every chunk in this directory into preview.html (a gallery, one card
// per chunk in its kind's layout) and index.md (the catalog for a co-presenter
// prompt). Run: node --import tsx dev/devprocess-talk/chunks/build.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KINDS = ["number", "quote", "contrast", "case", "rule", "timeline", "figure"] as const;
type Kind = (typeof KINDS)[number];

type Chunk = {
  id: string;
  kind: Kind;
  cue: string[];
  with: string[];
  source: string;
  headline: string;
  eyebrow: string;
  body: string[];
};

function fail(message: string): never {
  throw new Error(message);
}

function parse(id: string, text: string): Chunk {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) fail(`${id}: missing frontmatter`);
  const front: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (!kv) fail(`${id}: bad frontmatter line: ${line}`);
    front[kv[1]] = kv[2].trim();
  }
  const kind = front.kind as Kind;
  if (!KINDS.includes(kind)) fail(`${id}: unknown kind ${front.kind}`);
  const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const lines = m[2].split("\n");
  const headline = lines.find((l) => l.startsWith("# "))?.slice(2) ?? fail(`${id}: no headline`);
  const eyebrow = lines.find((l) => l.startsWith("## "))?.slice(3) ?? "";
  const body = lines.filter((l) => !l.startsWith("# ") && !l.startsWith("## "));
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const cue = list(front.cue);
  if (cue.length < 2) fail(`${id}: needs at least two cues`);
  return { id, kind, cue, with: list(front.with), source: front.source ?? "", headline, eyebrow, body };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

function fenced(body: string[]): { block: string[]; rest: string[] } {
  const start = body.findIndex((l) => l.startsWith("```"));
  if (start < 0) return { block: [], rest: body };
  const end = body.findIndex((l, i) => i > start && l.startsWith("```"));
  if (end < 0) fail("unterminated fence");
  return { block: body.slice(start + 1, end), rest: [...body.slice(0, start), ...body.slice(end + 1)].filter((l) => l.trim()) };
}

function payload(c: Chunk): string {
  const { body } = c;
  switch (c.kind) {
    case "number": {
      const lines = body.filter((l) => l.trim());
      if (lines.length % 2 !== 0 || lines.length > 4) fail(`${c.id}: number needs 1–2 figure/caption pairs`);
      const pairs: string[] = [];
      for (let i = 0; i < lines.length; i += 2) pairs.push(`<div class="pair"><div class="big">${inline(lines[i])}</div><div class="cap">${inline(lines[i + 1])}</div></div>`);
      return `<div class="pairs n${pairs.length}">${pairs.join("")}</div>`;
    }
    case "quote": {
      const { block, rest } = fenced(body);
      if (!block.length) fail(`${c.id}: quote needs a fenced block`);
      return `<blockquote>${block.map(inline).join("<br>")}</blockquote><div class="attr">${rest.map(inline).join(" ")}</div>`;
    }
    case "contrast": {
      const cols = body.filter((l) => l.trim());
      if (cols.length !== 2) fail(`${c.id}: contrast needs exactly two lines`);
      const split = (l: string) => {
        const k = l.match(/^([^:]{1,60}):\s*(.*)$/) ?? fail(`${c.id}: contrast line needs a "Label: text" shape`);
        return `<div class="col"><div class="lab">${esc(k[1])}</div><p>${inline(k[2])}</p></div>`;
      };
      return `<div class="cols">${split(cols[0])}${split(cols[1])}</div>`;
    }
    case "case": {
      const rows = body.filter((l) => l.trim().startsWith("|")).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim()));
      if (rows.length < 3) fail(`${c.id}: case needs a header, a rule and at least one row`);
      const [head, , ...data] = rows;
      return `<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${data.map((r) => `<tr>${r.map((d) => `<td>${inline(d)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    case "rule": {
      const { block } = fenced(body);
      if (!block.length) fail(`${c.id}: rule needs a fenced block`);
      return `<pre>${esc(block.join("\n"))}</pre>`;
    }
    case "timeline": {
      const items = body.filter((l) => l.trim());
      return `<ol class="rail">${items.map((l) => { const k = l.match(/^(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/) ?? fail(`${c.id}: timeline line needs "YYYY-MM-DD — event"`); return `<li><time>${k[1].slice(5)}</time><span>${inline(k[2])}</span></li>`; }).join("")}</ol>`;
    }
    case "figure": {
      const img = body.find((l) => l.startsWith("![")) ?? fail(`${c.id}: figure needs an image line`);
      const k = img.match(/^!\[(.*?)\]\((.*?)\)$/) ?? fail(`${c.id}: bad image line`);
      const cap = body.filter((l) => l.trim() && !l.startsWith("!["));
      return `<img src="${esc(k[2])}" alt="${esc(k[1])}"><div class="cap">${cap.map(inline).join(" ")}</div>`;
    }
  }
}

const files = readdirSync(here).filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "index.md").sort();
const chunks = files.map((f) => parse(f.replace(/\.md$/, ""), readFileSync(join(here, f), "utf8")));
const ids = new Set(chunks.map((c) => c.id));
for (const c of chunks) for (const w of c.with) if (!ids.has(w)) fail(`${c.id}: with: names unknown chunk ${w}`);

// Jargon check: repo-internal words outside fenced blocks. Each hit is printed;
// the README says every one must be replaced or defined in the same sentence.
// Words are matched whole, case-insensitive. Pass --strict to fail on any hit.
const JARGON = ["worktree", "worktrees", "workstream", "workstreams", "trailer", "trailers", "sigil", "sigils", "cull", "culled", "culling", "liveness", "the seam", "doctest", "doctests", "ledger", "smoke tier", "careful tier", "flake", "flakes", "flaky", "doc-check", "knip", "launchd", "frontmatter", "husk", "husks", "exhibit", "exhibits", "manual-testing", "pick-issues", "issue-actions", "after-action", "run-script", "walker", "bbx", "pnpm", "lint", "sha", "codex", "glm", "claude.md", "agents.md"];
const jargonRe = new RegExp(`(^|[^a-z0-9-])(${JARGON.map((w) => w.replace(/[-.]/g, "\\$&")).join("|")})(?![a-z0-9-])`, "gi");
let hits = 0;
for (const c of chunks) {
  const { rest } = fenced(c.body);
  const prose = [c.headline, c.eyebrow, ...c.cue, ...rest.filter((l) => !l.startsWith("!["))].join("\n").replace(/`[^`]*`/g, "");
  const found = new Set<string>();
  for (const m of prose.matchAll(jargonRe)) found.add(m[2].toLowerCase());
  if (found.size) { hits += found.size; console.log(`jargon  ${c.id}: ${[...found].join(", ")}`); }
}
if (hits && process.argv.includes("--strict")) fail(`${hits} jargon hits; see above`);

const card = (c: Chunk) => `<article class="card k-${c.kind}" id="${esc(c.id)}">
<div class="top"><span class="kind">${c.kind}</span><span class="id">${esc(c.id)}</span></div>
<div class="eyebrow">${inline(c.eyebrow)}</div>
<h2>${inline(c.headline)}</h2>
<div class="payload">${payload(c)}</div>
<div class="cues">${c.cue.map((q) => `<span>${esc(q)}</span>`).join("")}</div>
${c.with.length ? `<div class="with">with: ${c.with.map((w) => `<a href="#${esc(w)}">${esc(w)}</a>`).join(" · ")}</div>` : ""}
</article>`;

const counts = KINDS.map((k) => `${k} ${chunks.filter((c) => c.kind === k).length}`).join(" · ");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chunks preview</title>
<style>
  :root { --bg:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --mute:#a3a29c; --line:#e6e5e0; --blue:#2a78d6; --blue-l:#e3eefb; --orange:#eb6834; --aqua:#1baf7a; --dark:#24221e; }
  body { margin:0; background:#eceae4; color:var(--ink); font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:1280px; margin:0 auto; padding:28px 16px 80px; }
  h1 { font-size:1.5em; margin:0 0 .2em; }
  .lede { color:var(--ink2); max-width:80ch; margin:0 0 1.2em; }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 20px; }
  .filters button { font:13px system-ui; padding:6px 12px; border:1px solid var(--line); background:var(--bg); border-radius:999px; cursor:pointer; }
  .filters button.on { background:var(--dark); color:#fff; border-color:var(--dark); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(380px, 1fr)); gap:20px; }
  .card { background:var(--bg); border-radius:14px; box-shadow:0 2px 14px rgba(0,0,0,.08); padding:18px 20px 16px; display:flex; flex-direction:column; gap:10px; min-height:300px; position:relative; overflow:hidden; }
  .card.hide { display:none; }
  .top { display:flex; justify-content:space-between; font:500 11px ui-monospace,Menlo,monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--mute); }
  .kind { padding:2px 8px; border-radius:999px; background:var(--line); color:var(--ink2); }
  .eyebrow { font:500 12px ui-monospace,Menlo,monospace; letter-spacing:.1em; text-transform:uppercase; color:var(--ink2); }
  h2 { font-size:1.35em; line-height:1.15; margin:0; letter-spacing:-.02em; }
  .payload { flex:1; display:flex; flex-direction:column; justify-content:center; }
  .cues { display:flex; flex-wrap:wrap; gap:6px; border-top:1px solid var(--line); padding-top:10px; }
  .cues span { font-size:12px; color:var(--ink2); background:#f1efe9; padding:2px 8px; border-radius:6px; }
  .cues span:before { content:"“"; color:var(--mute); } .cues span:after { content:"”"; color:var(--mute); }
  .with { font-size:12px; color:var(--mute); } .with a { color:var(--blue); text-decoration:none; }
  code { font:0.92em ui-monospace,Menlo,monospace; background:#f1efe9; padding:0 4px; border-radius:4px; }

  .k-number .kind { background:var(--blue-l); color:var(--blue); }
  .pairs { display:grid; gap:18px; } .pairs.n2 { grid-template-columns:1fr 1fr; }
  .big { font-size:clamp(40px, 5vw, 64px); font-weight:700; letter-spacing:-.04em; line-height:1; color:var(--blue); }
  .pairs .cap { color:var(--ink2); font-size:14px; margin-top:6px; }

  .k-quote { background:var(--dark); color:#f1ede5; } .k-quote .eyebrow, .k-quote .top { color:#a59d90; } .k-quote .kind { background:#3a3732; color:#d3cabb; }
  .k-quote blockquote { margin:0; font-size:1.25em; line-height:1.3; font-weight:500; position:relative; padding-left:28px; }
  .k-quote blockquote:before { content:"“"; position:absolute; left:-4px; top:-14px; font-size:64px; color:var(--aqua); line-height:1; }
  .k-quote .attr { color:#a59d90; font-size:13px; margin-top:12px; padding-left:28px; }
  .k-quote .cues { border-top-color:#3a3732; } .k-quote .cues span { background:#3a3732; color:#d3cabb; } .k-quote code { background:#3a3732; }

  .k-contrast .kind { background:#fde9e0; color:var(--orange); }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:0; }
  .col { padding:12px 14px; } .col:first-child { background:#f1efe9; color:var(--ink2); border-radius:10px 0 0 10px; } .col:last-child { background:var(--blue-l); border-radius:0 10px 10px 0; }
  .col .lab { font:600 11px ui-monospace,Menlo,monospace; letter-spacing:.1em; text-transform:uppercase; margin-bottom:6px; } .col:last-child .lab { color:var(--blue); }
  .col p { margin:0; font-size:15px; }

  .k-case .kind { background:#e3f6ee; color:var(--aqua); }
  table { border-collapse:collapse; width:100%; font-size:14px; } th { text-align:left; font:600 11px ui-monospace,Menlo,monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--ink2); padding:6px 8px; border-bottom:2px solid var(--ink); } td { padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; } td:last-child { color:var(--blue); font-weight:500; }

  .k-rule .kind { background:#eee; color:var(--ink); }
  pre { margin:0; background:var(--dark); color:#e8e3d8; padding:16px 18px; border-radius:10px; font:13px/1.45 ui-monospace,Menlo,monospace; white-space:pre-wrap; border-left:6px solid var(--orange); }

  .k-timeline .kind { background:#eee8f8; color:#6a4fc0; }
  .rail { list-style:none; margin:0; padding:0 0 0 14px; border-left:2px solid var(--blue); }
  .rail li { position:relative; padding:0 0 12px 16px; font-size:14px; } .rail li:last-child { padding-bottom:0; }
  .rail li:before { content:""; position:absolute; left:-21px; top:6px; width:10px; height:10px; border-radius:50%; background:var(--bg); border:2px solid var(--blue); }
  .rail time { display:block; font:600 11px ui-monospace,Menlo,monospace; color:var(--blue); letter-spacing:.06em; }

  .k-figure { grid-column: span 2; } .k-figure .kind { background:#fff3d6; color:#9a6a00; }
  .k-figure img { width:100%; height:auto; display:block; border:1px solid var(--line); border-radius:8px; background:#fff; }
  .k-figure .cap { color:var(--ink2); font-size:14px; margin-top:8px; }
  @media (max-width: 820px) { .k-figure { grid-column: span 1; } }
</style>
</head>
<body>
<div class="wrap">
<h1>Chunks preview</h1>
<p class="lede">${chunks.length} chunks (${counts}). Each card is one observation in its kind's layout; the phrases at the bottom are the cues a co-presenter matches against speech. Source: the <code>.md</code> files in this directory; rebuilt by <code>build.ts</code>.</p>
<div class="filters"><button class="on" data-k="all">all</button>${KINDS.map((k) => `<button data-k="${k}">${k}</button>`).join("")}</div>
<div class="grid">
${chunks.map(card).join("\n")}
</div>
</div>
<script>
  document.querySelectorAll('.filters button').forEach(function (b) { b.addEventListener('click', function () {
    document.querySelectorAll('.filters button').forEach(function (x) { x.classList.toggle('on', x === b); });
    var k = b.dataset.k; document.querySelectorAll('.card').forEach(function (c) { c.classList.toggle('hide', k !== 'all' && !c.classList.contains('k-' + k)); });
  }); });
</script>
</body>
</html>
`;
writeFileSync(join(here, "preview.html"), html);

const index = `# Chunk catalog

${chunks.length} chunks (${counts}). Generated by \`build.ts\`; the gallery is [preview.html](preview.html). This table is the list a co-presenter prompt can carry: the id to show, the kind of card it is, the headline, and the phrases that should trigger it.

| id | kind | headline | cues |
|---|---|---|---|
${chunks.map((c) => `| ${c.id} | ${c.kind} | ${c.headline.replace(/\|/g, "\\|")} | ${c.cue.join("; ").replace(/\|/g, "\\|")} |`).join("\n")}
`;
writeFileSync(join(here, "index.md"), index);
console.log(`${chunks.length} chunks → preview.html, index.md (${counts})`);
