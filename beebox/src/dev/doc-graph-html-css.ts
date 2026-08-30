/**
 * The page stylesheet for the doc-graph HTML showcase, extracted as a single
 * string so the render functions stay focused on structure. Editorial,
 * paper-and-ink aesthetic; the per-pillar accent colors come from the data
 * tables and are applied inline via CSS custom properties.
 */

export const PAGE_CSS = `
  :root {
    --bg: #f5efe2;
    --paper: #fbf6e9;
    --paper-2: #ede4cc;
    --ink: #2a241d;
    --ink-soft: #5a4e3e;
    --muted: #8a7d68;
    --rule: #d8cdb1;
    --accent: #b35a1f;
    --link: #8c3d12;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background:
      radial-gradient(ellipse at top, #fff8e7 0%, var(--bg) 60%) no-repeat,
      var(--bg);
    color: var(--ink);
    font: 16px/1.6 "Iowan Old Style", "Charter", Georgia, "Times New Roman", serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; text-decoration-style: wavy; text-underline-offset: 3px; }
  code, .mono { font: 13px/1.5 "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace; }
  .muted { color: var(--muted); }

  .page { max-width: 1150px; margin: 0 auto; padding: 56px 32px 80px; }

  /* ---- Hero ---- */
  header.hero { padding-bottom: 36px; border-bottom: 1px dashed var(--rule); margin-bottom: 56px; }
  .hero .eyebrow {
    font: 11px/1 "Iowan Old Style", Georgia, serif;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 16px;
  }
  .hero h1 {
    font-size: 44px;
    font-weight: 600;
    margin: 0 0 16px;
    letter-spacing: -0.015em;
    line-height: 1.1;
    font-style: italic;
  }
  .hero .tagline {
    font-size: 19px;
    color: var(--ink-soft);
    margin: 0 0 28px;
    max-width: 720px;
    line-height: 1.55;
  }
  .hero .stats { display: flex; gap: 40px; flex-wrap: wrap; margin-top: 28px; }
  .stat { font: 12px/1 "Iowan Old Style", Georgia, serif; color: var(--muted); letter-spacing: 0.06em; text-transform: uppercase; }
  .stat strong {
    display: block;
    font-size: 32px;
    color: var(--ink);
    font-weight: 600;
    font-style: italic;
    margin-bottom: 4px;
    text-transform: none;
    letter-spacing: -0.01em;
  }

  /* ---- Sections ---- */
  h2.section {
    font-size: 30px;
    font-weight: 600;
    font-style: italic;
    letter-spacing: -0.01em;
    margin: 72px 0 4px;
  }
  .section-eyebrow {
    font: 11px/1 "Iowan Old Style", Georgia, serif;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 8px;
  }
  .section-lede {
    color: var(--ink-soft);
    margin: 0 0 32px;
    max-width: 740px;
    font-size: 17px;
  }

  /* ---- Rings ---- */
  .ring {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 28px;
    padding: 22px 28px;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 4px;
    margin-bottom: 14px;
    position: relative;
  }
  .ring::before {
    content: "";
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 6px;
    background: var(--c, var(--accent));
    border-radius: 4px 0 0 4px;
  }
  .ring-0 { --c: #b35a1f; background: linear-gradient(90deg, #fef1d8 0%, var(--paper) 80%); }
  .ring-1 { --c: #d97706; background: linear-gradient(90deg, #fdf3e0 0%, var(--paper) 80%); }
  .ring-2 { --c: #b08c4a; }
  .ring-3 { --c: #8a7d68; }
  .ring-4 { --c: #b3a487; opacity: 0.92; }

  .ring-num {
    display: inline-block;
    font: 10px/1 "Iowan Old Style", Georgia, serif;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .ring-label h3 { margin: 0 0 6px; font-size: 19px; font-weight: 600; font-style: italic; }
  .ring-flavour { margin: 0 0 6px; color: var(--ink); font-size: 14px; }
  .ring-trigger { margin: 0 0 10px; color: var(--muted); font-size: 13px; font-style: italic; }
  .ring-count {
    display: inline-block; padding: 3px 10px;
    background: var(--paper-2); border-radius: 12px;
    font: 11px/1 "JetBrains Mono", monospace; color: var(--ink-soft);
  }

  .ring-chips { display: flex; flex-wrap: wrap; gap: 6px 7px; align-content: flex-start; }
  .chip {
    display: inline-block;
    padding: 5px 10px;
    border-radius: 3px;
    font: 12px/1.2 "JetBrains Mono", "SF Mono", monospace;
    background: var(--paper-2);
    color: var(--ink);
    border-left: 3px solid var(--c);
    transition: transform 0.1s ease;
  }
  .chip:hover { text-decoration: none; transform: translateY(-1px); background: #e6dcc0; }
  .empty { color: var(--muted); font-size: 14px; font-style: italic; }

  /* ---- Pillars ---- */
  .pillars {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 20px;
  }
  .pillar {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 6px;
    overflow: hidden;
    display: flex; flex-direction: column;
  }
  .pillar-header {
    padding: 24px 24px 20px;
    color: #fff8e7;
    background-size: cover;
    background-position: center;
    background-color: var(--c);
    border-bottom: 3px solid var(--c);
    min-height: 130px;
  }
  .pillar-header h3 {
    margin: 0 0 8px;
    font-size: 24px;
    font-weight: 600;
    font-style: italic;
    letter-spacing: -0.01em;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }
  .pillar-blurb { margin: 0; font-size: 14px; line-height: 1.5; color: rgba(255,253,240,0.9); text-shadow: 0 1px 2px rgba(0,0,0,0.4); }
  .pillar-body { padding: 18px 22px 22px; flex: 1; display: flex; flex-direction: column; }
  .pillar-vibe {
    margin: 0 0 18px;
    font-style: italic;
    color: var(--ink-soft);
    font-size: 15px;
    line-height: 1.5;
    padding-left: 14px;
    border-left: 2px solid var(--c);
  }
  .pillar-entry {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--paper-2);
    border-radius: 4px;
    border-left: 4px solid var(--c);
    color: var(--ink);
    margin-bottom: 8px;
  }
  .pillar-entry:hover { background: #e6dcc0; text-decoration: none; }
  .entry-arrow { color: var(--c); font-weight: 700; font-size: 18px; }
  .entry-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .entry-path { font: 13px/1.2 "JetBrains Mono", monospace; word-break: break-word; }
  .entry-title { font-size: 12px; color: var(--muted); }
  .entry-note {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--ink-soft);
    font-style: italic;
    padding: 0 4px;
  }
  .pillar-entry.missing { color: #b91c1c; background: #fef2f2; border-color: #b91c1c; }

  .pillar-support { list-style: none; padding: 0; margin: 0 0 16px; display: flex; flex-direction: column; gap: 10px; }
  .pillar-support li {
    padding: 8px 10px;
    border-radius: 3px;
    background: rgba(0,0,0,0.02);
  }
  .pillar-support li.missing { color: #b91c1c; }
  .pillar-support .path { font: 12px/1.3 "JetBrains Mono", monospace; }
  .pillar-support .meta { font-size: 11px; color: var(--muted); margin-left: 8px; }
  .pillar-support .curator-note {
    display: block;
    margin-top: 4px;
    font-size: 13px;
    color: var(--ink-soft);
    font-style: italic;
    line-height: 1.45;
  }
  .pillar-code { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 12px; border-top: 1px dashed var(--rule); }
  .code-tag {
    padding: 3px 9px;
    background: var(--paper-2);
    color: var(--ink-soft);
    border-radius: 3px;
    font-size: 11px;
  }

  /* ---- Curator section ---- */
  .curator { margin-top: 48px; }
  .curator-section {
    margin-bottom: 40px;
    padding: 24px 28px;
    background: var(--paper);
    border-radius: 4px;
    border: 1px solid var(--rule);
  }
  .curator-section h3 {
    margin: 0 0 6px;
    font-size: 22px;
    font-style: italic;
    font-weight: 600;
    color: var(--accent);
  }
  .curator-blurb {
    margin: 0 0 20px;
    color: var(--ink-soft);
    font-size: 14px;
    font-style: italic;
    max-width: 720px;
  }
  .curator-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px 24px; }
  .curator-list li {
    padding: 10px 0;
    border-top: 1px dotted var(--rule);
  }
  .curator-list li.missing { color: #b91c1c; }
  .curator-list .path { font: 12px/1.3 "JetBrains Mono", monospace; }
  .curator-list .meta { font-size: 11px; color: var(--muted); margin-left: 6px; }
  .curator-list .curator-note { margin: 4px 0 0; font-size: 13px; color: var(--ink-soft); line-height: 1.5; font-style: italic; }

  /* ---- Health ---- */
  .health {
    margin-top: 56px; padding: 16px 22px;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 4px;
  }
  .health summary { cursor: pointer; color: var(--ink-soft); font-size: 13px; font-style: italic; }
  .health summary:hover { color: var(--ink); }
  .health-body { margin-top: 12px; }
  .health-body ul { padding-left: 20px; font-size: 13px; color: var(--muted); }
  .health-body code { color: var(--ink); }

  footer.colophon {
    margin-top: 56px; padding-top: 24px;
    border-top: 1px dashed var(--rule);
    color: var(--muted); font-size: 12px; font-style: italic;
  }
`;
