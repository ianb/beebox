/**
 * The question bar's markup and script, added to the dashboard's page
 * (docs/plans/shared-browser-ask.subplan.md).
 *
 * The script runs first in `<head>`, before the dashboard's own, and hangs the
 * bar from `<html>` rather than `<body>`, so the dashboard's React root never
 * sees it. Its window-level capture listener is registered before any of the
 * dashboard's, and keeps keys typed in the bar from reaching the dashboard,
 * which would send them to the page in the browser. All text goes in through
 * `textContent`: a question can quote a page.
 */

export const QUESTION_BAR_SCRIPT = `(function () {
  var base = new URL("_box/", location.href).href;
  var bar = document.createElement("div");
  bar.id = "bbx-question-bar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Your agent is waiting");
  bar.hidden = true;
  var rows = {};
  ["keydown", "keypress", "keyup", "paste", "copy", "cut"].forEach(function (name) {
    window.addEventListener(name, function (e) {
      if (bar.contains(e.target)) e.stopImmediatePropagation();
    }, true);
  });
  function el(tag, parent, text) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  }
  function removeRow(id) {
    if (rows[id]) rows[id].node.remove();
    delete rows[id];
    bar.hidden = Object.keys(rows).length === 0;
  }
  function settle(id) {
    var row = rows[id];
    row.stuck = true;
    row.done.remove();
    row.notDone.remove();
    var close = el("button", row.node, "Close");
    close.type = "button";
    close.addEventListener("click", function () { removeRow(id); });
    row.node.insertBefore(close, row.status);
  }
  function answer(id, outcome) {
    var row = rows[id];
    row.done.disabled = row.notDone.disabled = true;
    row.status.textContent = "Sending...";
    // The route takes the question off the list while it sends: a poll must not drop the words.
    row.sending = true;
    fetch(base + "answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: id, outcome: outcome, text: row.text.value }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        row.sending = false;
        if (res.ok) { removeRow(id); return; }
        row.status.textContent = body.error || ("The answer was not sent (" + res.status + ")");
        // Nothing left to press: keep the words on screen to copy until the person closes it.
        if (res.status === 410 || res.status === 409) { settle(id); refresh(); return; }
        row.done.disabled = row.notDone.disabled = false;
      });
    }).catch(function () {
      row.sending = false;
      row.status.textContent = "The answer was not sent: the box did not respond";
      row.done.disabled = row.notDone.disabled = false;
    });
  }
  function addRow(q) {
    var node = el("div", bar);
    node.className = "bbx-q";
    el("p", node, q.text);
    if (q.pageUrl) el("small", node, "About " + q.pageUrl);
    var text = el("textarea", node);
    text.rows = 1;
    text.placeholder = "Note for the chat (no passwords)";
    text.setAttribute("aria-label", "Your answer");
    var done = el("button", node, "Done");
    var notDone = el("button", node, "Not done");
    done.type = notDone.type = "button";
    var status = el("span", node);
    status.setAttribute("role", "status");
    rows[q.id] = { node: node, text: text, done: done, notDone: notDone, status: status, stuck: false, sending: false };
    done.addEventListener("click", function () { answer(q.id, "done"); });
    notDone.addEventListener("click", function () { answer(q.id, "not-done"); });
  }
  function show(questions) {
    var waiting = {};
    questions.forEach(function (q) {
      waiting[q.id] = true;
      if (!rows[q.id]) addRow(q);
    });
    Object.keys(rows).forEach(function (id) {
      if (!waiting[id] && !rows[id].stuck && !rows[id].sending) removeRow(id);
    });
    bar.hidden = Object.keys(rows).length === 0;
  }
  function refresh() {
    fetch(base + "question", { cache: "no-store" }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (body) {
      if (body) show(body.questions);
    }).catch(function () {});
  }
  function start() {
    document.documentElement.appendChild(bar);
    refresh();
    setInterval(function () { if (!document.hidden) refresh(); }, 3000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();`;

const QUESTION_BAR_STYLE = `#bbx-question-bar{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483647;width:min(640px,calc(100vw - 24px));max-height:50vh;overflow:auto;background:#fffdf8;color:#2b2415;border:1px solid #b9a982;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.35);font:14px/1.4 system-ui,sans-serif}
#bbx-question-bar[hidden]{display:none}
#bbx-question-bar .bbx-q{padding:10px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#bbx-question-bar .bbx-q+.bbx-q{border-top:1px solid #d9cfb8}
#bbx-question-bar p{margin:0;flex:1 0 100%;white-space:pre-wrap;font-weight:600}
#bbx-question-bar textarea{flex:1 1 240px;font:inherit;padding:4px 6px;background:#fff;color:inherit;border:1px solid #b9a982;border-radius:4px;resize:vertical}
#bbx-question-bar button{font:inherit;padding:4px 12px;background:#f1e8d3;color:inherit;border:1px solid #b9a982;border-radius:4px;cursor:pointer}
#bbx-question-bar button:disabled{opacity:.5;cursor:default}
#bbx-question-bar small{flex:1 0 100%;overflow-wrap:anywhere;color:#6b5f45}
#bbx-question-bar span{flex:1 0 100%}
#bbx-question-bar span:empty{display:none}`;

export const QUESTION_BAR_HTML = `<style>${QUESTION_BAR_STYLE}</style><script>${QUESTION_BAR_SCRIPT}</script>`;
