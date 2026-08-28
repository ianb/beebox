// The retired /dev/docs browser's inline assets: its stylesheet and the
// self-contained Cmd-P quick-open overlay. Split out of router-doc-browser.ts
// purely for file size — both are one long template literal each.
//
// RETIRED: `/<worktree>/dev/docs/…` 301s to `/workstreams/browse?file=…`
// (callback-box/docs/plans/general-browser.md, Track 5), so nothing reaches
// this code at runtime. It is kept, not deleted, because the closed-issue pill
// feature it rendered has not been ported to the general browser yet — see
// issues/code-quality/2026-08-22-retire-doc-browser-dead-code.md, which asks for
// the port to land first so the retirement does not quietly lose a feature.


export const DOC_BROWSER_CSS = `
  body { max-width: none; padding: 0; }
  .chip-closed-link { display: inline-block; margin: 0 0 0 0.4em; padding: 0.15em 0.55em; border-radius: 10px; background: #eef1f5; color: #555; font-size: 0.78em; text-decoration: none; }
  nav.crumbs { padding: 0.7em 1.2em; margin: 0; }
  .docwrap { display: flex; align-items: flex-start; gap: 0; }
  aside.docnav { flex: 0 0 20em; position: sticky; top: 0; max-height: 100vh; overflow-y: auto; border-right: 1px solid #eee; padding: 0.5em 0.8em 3em; font: 13px ui-monospace, Menlo, monospace; }
  .docnav-head { color: #888; font-size: 0.85em; margin: 0.4em 0 0.4em; }
  .docsort { font-size: 0.85em; margin: 0 0 0.9em; }
  .docsort a { text-decoration: none; color: #999; }
  .docsort a.on { color: #222; font-weight: 700; }
  aside.docnav details { margin-bottom: 0.3em; }
  aside.docnav summary { cursor: pointer; color: #444; padding: 0.2em 0; }
  aside.docnav summary .n { color: #aaa; font-size: 0.85em; }
  aside.docnav ul { list-style: none; padding: 0 0 0.4em 0.9em; margin: 0.2em 0; }
  aside.docnav li { padding: 0.12em 0; }
  aside.docnav li a { text-decoration: none; color: #2255aa; }
  aside.docnav li.active a { font-weight: 700; color: #a2380a; }
  aside.docnav ul.flat { padding-left: 0; }
  aside.docnav ul.flat li { display: flex; justify-content: space-between; gap: 0.6em; align-items: baseline; }
  aside.docnav ul.flat li a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  aside.docnav ul.flat .date { color: #aaa; font-size: 0.8em; white-space: nowrap; }
  main.doccontent { flex: 1 1 auto; min-width: 0; max-width: 820px; padding: 0.5em 2em 5em; }
  main.doccontent .placeholder { color: #888; margin-top: 3em; }
  .qo-hint { position: fixed; bottom: 0.7em; right: 1em; font: 11px ui-monospace, monospace; color: #bbb; user-select: none; }
  .qo-hint kbd { background: #f0f0f0; border: 1px solid #ddd; border-bottom-width: 2px; border-radius: 4px; padding: 0.05em 0.35em; color: #666; }
  .qo-backdrop { position: fixed; inset: 0; background: rgba(20,20,25,0.28); display: flex; align-items: flex-start; justify-content: center; z-index: 1000; }
  .qo-backdrop[hidden] { display: none; }
  .qo-panel { margin-top: 12vh; width: min(620px, 92vw); background: #fff; border: 1px solid #ccc; border-radius: 10px; box-shadow: 0 12px 48px rgba(0,0,0,0.25); overflow: hidden; }
  .qo-panel input { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid #eee; padding: 0.8em 1em; font: 15px system-ui, sans-serif; outline: none; }
  .qo-results { list-style: none; margin: 0; padding: 0.3em 0; max-height: 52vh; overflow-y: auto; font: 13px ui-monospace, Menlo, monospace; }
  .qo-results li { padding: 0.35em 1em; cursor: pointer; display: flex; align-items: baseline; gap: 0.55em; white-space: nowrap; overflow: hidden; }
  .qo-results li.sel { background: #eef3fb; }
  .qo-results .qo-name { color: #222; text-overflow: ellipsis; overflow: hidden; }
  .qo-results li.sel .qo-name { color: #a2380a; }
  .qo-results .qo-dir { color: #aaa; font-size: 0.86em; text-overflow: ellipsis; overflow: hidden; }
  .qo-results mark { background: none; color: #2255aa; font-weight: 700; }
  .qo-results li.sel mark { color: #a2380a; }
  .qo-empty { padding: 0.7em 1em; color: #999; font: 13px ui-monospace, monospace; }
`;

// VS-Code-style Cmd-P / Ctrl-P quick-open over the full doc list. Self-contained
// vanilla overlay: the file list ships as JSON, a compact subsequence fuzzy
// scorer ranks matches (basename + contiguous runs favoured), keyboard-first.
// `files` are already collected server-side; `base` is like "/main/dev".
export function renderDocQuickOpen(base: string, files: string[]): string {
  // Serialize for a <script> context: neutralize "</script>" and JS line
  // separators so the array survives inline embedding.
  const filesJson = JSON.stringify(files)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const baseJson = JSON.stringify(base).replace(/</g, "\\u003c");
  return `<div class="qo-hint"><kbd id="qo-hint-key">Ctrl-P</kbd> quick open</div>
<div class="qo-backdrop" id="qo" hidden role="dialog" aria-modal="true" aria-label="Quick open document">
  <div class="qo-panel">
    <input id="qo-input" type="text" placeholder="Go to doc…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="qo-results" aria-autocomplete="list">
    <ul class="qo-results" id="qo-results" role="listbox"></ul>
  </div>
</div>
<script>
(function () {
  var FILES = ${filesJson};
  var BASE = ${baseJson};
  var LIMIT = 50;
  var backdrop = document.getElementById("qo");
  var input = document.getElementById("qo-input");
  var list = document.getElementById("qo-results");
  var matches = [];
  var sel = 0;
  var lastFocus = null;
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var hintKey = document.getElementById("qo-hint-key");
  if (isMac && hintKey) hintKey.textContent = "⌘P";

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Greedy leftmost subsequence match with positional scoring. Returns
  // {score, pos:[indices]} or null when q is not a subsequence of target.
  function score(q, target) {
    if (!q) return { score: 0, pos: [] };
    var t = target.toLowerCase();
    var ql = q.toLowerCase();
    var slash = target.lastIndexOf("/");
    var pos = [];
    var total = 0;
    var ti = 0;
    var prev = -2;
    for (var qi = 0; qi < ql.length; qi++) {
      var found = -1;
      for (var j = ti; j < t.length; j++) { if (t[j] === ql[qi]) { found = j; break; } }
      if (found === -1) return null;
      var s = 1;
      if (found === prev + 1) s += 5;                                  // contiguous run
      var pc = found > 0 ? t[found - 1] : "/";
      if (pc === "/" || pc === "-" || pc === "_" || pc === "." || pc === " ") s += 3; // word start
      if (found > slash) s += 4;                                       // inside basename
      if (found === slash + 1) s += 3;                                 // at basename start
      total += s;
      pos.push(found);
      prev = found;
      ti = found + 1;
    }
    total -= target.length * 0.02;                                     // mild shortness bias
    return { score: total, pos: pos };
  }

  function compute(q) {
    var out = [];
    for (var i = 0; i < FILES.length; i++) {
      var r = score(q, FILES[i]);
      if (r) out.push({ file: FILES[i], score: r.score, pos: r.pos, i: i });
    }
    out.sort(function (a, b) { return b.score - a.score || a.file.localeCompare(b.file); });
    return out.slice(0, LIMIT);
  }

  // Render one path with matched chars marked, basename vs dir split visually.
  function markup(file, pos) {
    var set = {};
    for (var k = 0; k < pos.length; k++) set[pos[k]] = true;
    var slash = file.lastIndexOf("/");
    var dir = slash >= 0 ? file.slice(0, slash + 1) : "";
    var html = "";
    for (var c = 0; c < file.length; c++) {
      var ch = esc(file[c]);
      html += set[c] ? "<mark>" + ch + "</mark>" : ch;
      if (c === slash) html = '<span class="qo-dir">' + html + '</span><span class="qo-name">';
    }
    if (slash >= 0) html += "</span>";
    else html = '<span class="qo-name">' + html + "</span>";
    return html;
  }

  function render() {
    if (!matches.length) {
      list.innerHTML = '<li class="qo-empty" role="option">No matching docs</li>';
      return;
    }
    var h = "";
    for (var i = 0; i < matches.length; i++) {
      h += '<li role="option" data-i="' + i + '"' + (i === sel ? ' class="sel" aria-selected="true"' : "") + ">" + markup(matches[i].file, matches[i].pos) + "</li>";
    }
    list.innerHTML = h;
    var selEl = list.querySelector("li.sel");
    if (selEl) selEl.scrollIntoView({ block: "nearest" });
  }

  function refresh() {
    matches = compute(input.value.trim());
    sel = 0;
    render();
  }

  function open() {
    if (!backdrop.hidden) return;
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    input.value = "";
    refresh();
    input.focus();
  }

  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function go() {
    var m = matches[sel];
    if (!m) return;
    var url = BASE + "/docs/" + m.file.split("/").map(encodeURIComponent).join("/");
    location.href = url;
  }

  document.addEventListener("keydown", function (e) {
    // Cmd-P (mac) / Ctrl-P — intercept the browser print shortcut.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      if (backdrop.hidden) open(); else close();
      return;
    }
    if (backdrop.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (matches.length) { sel = (sel + 1) % matches.length; render(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (matches.length) { sel = (sel - 1 + matches.length) % matches.length; render(); } }
    else if (e.key === "Enter") { e.preventDefault(); go(); }
    else if (e.key === "Tab") { e.preventDefault(); } // trap focus in the dialog
  });

  input.addEventListener("input", refresh);
  list.addEventListener("mousemove", function (e) {
    var li = e.target.closest("li[data-i]");
    if (li) { var i = Number(li.getAttribute("data-i")); if (i !== sel) { sel = i; render(); } }
  });
  list.addEventListener("click", function (e) {
    var li = e.target.closest("li[data-i]");
    if (li) { sel = Number(li.getAttribute("data-i")); go(); }
  });
  backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) close(); });
})();
</script>`;
}
