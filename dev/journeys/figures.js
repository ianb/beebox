"use strict";
// Emits the SVG figures embedded in overview.md from the numbers in
// reports/sweep-walks.md and reports/sweep-issues.md. Rerun after a new
// round lands and the sweeps are refreshed:
//
//   node --import tsx dev/journeys/figures.ts
//
// One accent hue, gray for everything that is not the point, aqua reserved
// for "fixed", orange for "harness". Numbers live only in the DATA block.
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var node_url_1 = require("node:url");
var OUT = (0, node_path_1.join)((0, node_path_1.dirname)((0, node_url_1.fileURLToPath)(import.meta.url)), "figures");
var BLUE = "#2a78d6";
var ORANGE = "#eb6834";
var AQUA = "#1baf7a";
var RED = "#d03b3b";
var INK = "#1f2933";
var MUTED = "#6b7280";
var RULE = "#d9dde3";
var LIGHT = "#e8eef7";
var PAPER = "#ffffff";
// Claim rows, harness rows and new issues filed per walk (sweep-walks §4, §7;
// sweep-issues §5, §8). The two Aug 23 B pilots have no claim table.
var WALKS = [
    { journey: "B", round: 0, rows: 11, harness: 4, filed: 3 },
    { journey: "A", round: 0, rows: 19, harness: 1, filed: 8 },
    { journey: "C", round: 1, rows: 30, harness: 3, filed: 3 },
    { journey: "D", round: 1, rows: 85, harness: 5, filed: 5 },
    { journey: "F", round: 1, rows: 85, harness: 2, filed: 5 },
    { journey: "A", round: 2, rows: 88, harness: 4, filed: 17 },
    { journey: "B", round: 2, rows: 119, harness: 11, filed: 7, note: "photos damaged in repo" },
    { journey: "B", round: 2, rows: 91, harness: 12, filed: 4, note: "relative upload path" },
    { journey: "C", round: 2, rows: 49, harness: 3, filed: 5 },
    { journey: "D", round: 2, rows: 108, harness: 6, filed: 5 },
    { journey: "F", round: 2, rows: 116, harness: 2, filed: 4 },
    { journey: "A", round: 3, rows: 79, harness: 12, filed: 6, note: "5-hour stall" },
    { journey: "B", round: 3, rows: 90, harness: 10, filed: 3 },
    { journey: "C", round: 3, rows: 88, harness: 5, filed: 3 },
    { journey: "D", round: 3, rows: 84, harness: 11, filed: 4, note: "0 screenshots" },
    { journey: "D", round: 3, rows: 82, harness: 4, filed: 1 },
    { journey: "F", round: 3, rows: 97, harness: 5, filed: 3 },
];
var ROUNDS = ["Aug 23–25", "Sep 20–21", "Oct 8", "Oct 9"];
var JOURNEYS = [
    ["A", "Lending"],
    ["B", "Inventory"],
    ["C", "Reconnecting"],
    ["D", "Chemistry"],
    ["F", "Newcomer"],
];
// Funnel (sweep-issues §8, flow block).
var FUNNEL = {
    rows: 1321,
    product: 1057,
    harness: 100,
    wishes: 74,
    unverified: 26,
    other: 64, // environment, boundary, dissolved, other
    issues: 98,
    implemented: 47,
    wontfix: 3,
    needsHuman: 8,
    deferred: 10,
    harnessOpen: 2,
    untouched: 28,
};
// Kinds (sweep-issues §8 §2): [label, open, closed]
var KINDS = [
    ["Functional defect", 13, 16],
    ["Vocabulary, wording", 11, 14],
    ["Assistant behavior", 6, 6],
    ["Navigation, layout", 4, 5],
    ["Missing feature", 7, 0],
    ["Harness, tooling", 2, 4],
    ["Accessibility naming", 1, 3],
    ["Decision needed", 3, 0],
    ["Privacy boundary", 1, 2],
];
// Days from filing to close for the 50 closed issues (sweep-issues §8 §3).
var DAYS_TO_CLOSE = __spreadArray(__spreadArray([], Array.from({ length: 33 }, function () { return 0; }), true), [
    1, 1, 1, 1, 1, 3, 4, 4, 6, 6, 9, 15, 17, 21, 22, 26, 31,
], false);
var STORIES = [
    {
        name: "plate header prints a scope glob",
        events: [
            { d: "10-08", kind: "filed" },
            { d: "10-08", kind: "closed" },
            { d: "10-09", kind: "confirmed" },
        ],
    },
    {
        name: "document metadata displaces the reading view",
        events: [
            { d: "09-21", kind: "filed" },
            { d: "09-21", kind: "re" },
            { d: "10-06", kind: "closed" },
            { d: "10-08", kind: "confirmed" },
        ],
    },
    {
        name: "tutor teaches a neutral-isotope rule",
        events: [
            { d: "09-21", kind: "filed" },
            { d: "09-24", kind: "wontfix" },
            { d: "10-08", kind: "confirmed" },
            { d: "10-09", kind: "confirmed" },
        ],
    },
    {
        name: "chats bind to a landmark once and never move",
        events: [
            { d: "08-25", kind: "filed" },
            { d: "09-21", kind: "re" },
            { d: "10-08", kind: "re" },
            { d: "10-09", kind: "re" },
            { d: "10-10", kind: "open" },
        ],
    },
    {
        name: "fresh-chat reservation suppresses openers",
        events: [
            { d: "09-21", kind: "filed" },
            { d: "10-08", kind: "re" },
            { d: "10-08", kind: "closed" },
            { d: "10-09", kind: "confirmed" },
        ],
    },
];
// Recurring frictions by round (overview §11): h = hit, p = partly fixed,
// f = fixed and confirmed, "" = not reported.
var FRICTION = [
    ["First screen says nothing; no openers", ["h", "h", "h", "p"]],
    ["No front door to the collection", ["h", "", "h", "p"]],
    ["Activity rows speak in commands and files", ["", "", "h", "h"]],
    ["Agent promises delivery it cannot make", ["", "h", "h", "h"]],
    ["Implementation vocabulary on screen", ["h", "h", "h", "p"]],
    ["Plate badge opens Browse, hides the chat", ["", "h", "h", "f"]],
    ["Conversations never get a title", ["", "h", "h", "f"]],
    ["Chats bind to a landmark once", ["h", "", "h", "h"]],
    ["Structured card fronts hide their facts", ["", "", "h", "h"]],
];
// ---------------------------------------------------------------- helpers
var esc = function (s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
};
var text = function (x, y, s, o) {
    var _a, _b, _c, _d;
    if (o === void 0) { o = {}; }
    return "<text x=\"".concat(x, "\" y=\"").concat(y, "\" font-size=\"").concat((_a = o.size) !== null && _a !== void 0 ? _a : 13, "\" fill=\"").concat((_b = o.fill) !== null && _b !== void 0 ? _b : INK, "\" text-anchor=\"").concat((_c = o.anchor) !== null && _c !== void 0 ? _c : "start", "\" font-weight=\"").concat((_d = o.weight) !== null && _d !== void 0 ? _d : 400, "\"").concat(o.mono ? ' font-family="ui-monospace, SFMono-Regular, Menlo, monospace"' : "", ">").concat(esc(s), "</text>");
};
var rect = function (x, y, w, h, fill, extra) {
    if (extra === void 0) { extra = ""; }
    return "<rect x=\"".concat(x, "\" y=\"").concat(y, "\" width=\"").concat(w, "\" height=\"").concat(h, "\" fill=\"").concat(fill, "\" ").concat(extra, "/>");
};
var line = function (x1, y1, x2, y2, stroke, w, extra) {
    if (stroke === void 0) { stroke = RULE; }
    if (w === void 0) { w = 1; }
    if (extra === void 0) { extra = ""; }
    return "<line x1=\"".concat(x1, "\" y1=\"").concat(y1, "\" x2=\"").concat(x2, "\" y2=\"").concat(y2, "\" stroke=\"").concat(stroke, "\" stroke-width=\"").concat(w, "\" ").concat(extra, "/>");
};
var circle = function (cx, cy, r, fill, extra) {
    if (extra === void 0) { extra = ""; }
    return "<circle cx=\"".concat(cx, "\" cy=\"").concat(cy, "\" r=\"").concat(r, "\" fill=\"").concat(fill, "\" ").concat(extra, "/>");
};
var svg = function (w, h, title, body) {
    return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 ".concat(w, " ").concat(h, "\" width=\"").concat(w, "\" height=\"").concat(h, "\" font-family=\"-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif\" role=\"img\" aria-label=\"").concat(esc(title), "\">\n<title>").concat(esc(title), "</title>\n").concat(rect(0, 0, w, h, PAPER), "\n").concat(body, "\n</svg>\n");
};
var fmt = function (n) { return n.toLocaleString("en-US"); };
// ---------------------------------------------------------------- 1. pipeline
function pipeline() {
    var W = 960;
    var H = 300;
    var steps = [
        { name: "Define", what: "journey.yaml: the person, the box, watch_for", tracked: true },
        { name: "Prepare", what: "fresh box, assets, prompt, snapshot", tracked: true },
        { name: "Walk", what: "an agent plays the person, ~60 actions", tracked: false },
        { name: "Collect", what: "box commits + screenshot clock", tracked: false },
        { name: "After-action", what: "one row per claim, four buckets", tracked: true },
        { name: "Report", what: "the only durable record of a run", tracked: true },
        { name: "Issues", what: "filed, corrected, re-encountered", tracked: true },
    ];
    var n = steps.length;
    var gap = 10;
    var x0 = 24;
    var bw = (W - 2 * x0 - gap * (n - 1)) / n;
    var y = 70;
    var bh = 64;
    var b = "";
    b += text(x0, 34, "The pipeline: seven steps, five of them in git", { size: 18, weight: 600 });
    steps.forEach(function (s, i) {
        var x = x0 + i * (bw + gap);
        var fill = s.tracked ? LIGHT : PAPER;
        var stroke = s.tracked ? BLUE : MUTED;
        b += rect(x, y, bw, bh, fill, "rx=\"6\" stroke=\"".concat(stroke, "\" stroke-width=\"1.5\"").concat(s.tracked ? "" : ' stroke-dasharray="4 3"'));
        b += text(x + bw / 2, y + 26, s.name, { anchor: "middle", weight: 600, size: 14 });
        b += text(x + bw / 2, y + 46, s.tracked ? "in git" : "gitignored", { anchor: "middle", size: 11, fill: s.tracked ? BLUE : MUTED });
        if (i < n - 1) {
            var ax = x + bw + gap / 2;
            b += "<path d=\"M".concat(x + bw + 1, " ").concat(y + bh / 2, " L").concat(ax + 4, " ").concat(y + bh / 2, "\" stroke=\"").concat(MUTED, "\" stroke-width=\"1.5\" marker-end=\"url(#arr)\"/>");
        }
        // caption under each box, wrapped by hand into two lines
        var words = s.what.split(" ");
        var l1 = [];
        var l2 = [];
        for (var _i = 0, words_1 = words; _i < words_1.length; _i++) {
            var w = words_1[_i];
            (l1.join(" ").length < 18 ? l1 : l2).push(w);
        }
        b += text(x + bw / 2, y + bh + 22, l1.join(" "), { anchor: "middle", size: 11.5, fill: MUTED });
        b += text(x + bw / 2, y + bh + 38, l2.join(" "), { anchor: "middle", size: 11.5, fill: MUTED });
    });
    // the rule and the loop
    b += text(x0, 210, "Nothing from a walk becomes a finding until it has been separately verified.", { size: 13, fill: INK });
    b += text(x0, 230, "The walker's job is to notice. The reader's is to find out what actually happened.", { size: 13, fill: MUTED });
    var lx = x0 + 6 * (bw + gap) + bw / 2;
    var sx = x0 + 2 * (bw + gap) + bw / 2;
    b += "<path d=\"M".concat(lx, " ").concat(y + bh + 46, " C ").concat(lx, " 275, ").concat(sx, " 275, ").concat(sx, " ").concat(y + bh + 46, "\" fill=\"none\" stroke=\"").concat(BLUE, "\" stroke-width=\"1.5\" stroke-dasharray=\"5 4\" marker-end=\"url(#arrb)\"/>");
    b += text((lx + sx) / 2, 262, "the next round's walk re-checks every open issue it meets", { anchor: "middle", size: 11.5, fill: BLUE });
    var defs = "<defs><marker id=\"arr\" markerWidth=\"8\" markerHeight=\"8\" refX=\"6\" refY=\"4\" orient=\"auto\"><path d=\"M0 0 L8 4 L0 8 z\" fill=\"".concat(MUTED, "\"/></marker><marker id=\"arrb\" markerWidth=\"8\" markerHeight=\"8\" refX=\"6\" refY=\"4\" orient=\"auto\"><path d=\"M0 0 L8 4 L0 8 z\" fill=\"").concat(BLUE, "\"/></marker></defs>");
    return svg(W, H, "The journey pipeline", defs + b);
}
// ---------------------------------------------------------------- 2. funnel
function funnel() {
    var W = 960;
    var H = 360;
    var x0 = 24;
    var barW = W - 2 * x0;
    var b = "";
    b += text(x0, 34, "From 1,321 claim rows to 98 issues to 47 fixes", { size: 18, weight: 600 });
    var segs1 = [
        ["product", FUNNEL.product, BLUE],
        ["harness", FUNNEL.harness, ORANGE],
        ["wishes", FUNNEL.wishes, "#9bbbe6"],
        ["unverified", FUNNEL.unverified, "#c7cdd6"],
        ["other", FUNNEL.other, "#e1e5ea"],
    ];
    var y1 = 70;
    var h1 = 36;
    b += text(x0, y1 - 10, "Claim rows, 17 walks with tables: ".concat(fmt(FUNNEL.rows)), { size: 12.5, fill: MUTED });
    var x = x0;
    for (var _i = 0, segs1_1 = segs1; _i < segs1_1.length; _i++) {
        var _a = segs1_1[_i], label = _a[0], v = _a[1], fill = _a[2];
        var w = (v / FUNNEL.rows) * barW;
        b += rect(x, y1, Math.max(w - 2, 1), h1, fill, 'rx="3"');
        if (w > 60)
            b += text(x + 8, y1 + 23, "".concat(label, " ").concat(fmt(v)), { size: 12.5, fill: fill === BLUE ? PAPER : INK });
        x += w;
    }
    // small labels for thin segments
    b += text(x0 + barW, y1 + h1 + 16, "unverified ".concat(FUNNEL.unverified, " \u00B7 other ").concat(FUNNEL.other), { anchor: "end", size: 11, fill: MUTED });
    // wedge to issues
    var y2 = 170;
    var h2 = 36;
    var issuesW = (FUNNEL.issues / FUNNEL.rows) * barW * 6; // scaled ×6 so it is legible; said in the label
    b += "<path d=\"M".concat(x0, " ").concat(y1 + h1, " L").concat(x0 + barW, " ").concat(y1 + h1, " L").concat(x0 + issuesW, " ").concat(y2, " L").concat(x0, " ").concat(y2, " Z\" fill=\"").concat(LIGHT, "\" opacity=\"0.7\"/>");
    b += text(x0 + barW, y2 - 8, "one issue per 13 rows; issues drawn at 6× so the bar can be read", { anchor: "end", size: 11, fill: MUTED });
    b += text(x0, y2 - 10, "Issues filed: ".concat(FUNNEL.issues), { size: 12.5, fill: MUTED });
    var segs2 = [
        ["fixed", FUNNEL.implemented, AQUA],
        ["won't fix", FUNNEL.wontfix, "#9fd9c3"],
        ["needs a human", FUNNEL.needsHuman, RED],
        ["deferred", FUNNEL.deferred, "#c7cdd6"],
        ["harness", FUNNEL.harnessOpen, ORANGE],
        ["untouched", FUNNEL.untouched, "#e1e5ea"],
    ];
    x = x0;
    for (var _b = 0, segs2_1 = segs2; _b < segs2_1.length; _b++) {
        var _c = segs2_1[_b], label = _c[0], v = _c[1], fill = _c[2];
        var w = (v / FUNNEL.issues) * issuesW;
        b += rect(x, y2, Math.max(w - 2, 1), h2, fill, 'rx="3"');
        if (w > 70)
            b += text(x + 8, y2 + 23, "".concat(label, " ").concat(v), { size: 12.5, fill: fill === AQUA || fill === RED ? PAPER : INK });
        x += w;
    }
    b += text(x0, y2 + h2 + 18, "won't fix ".concat(FUNNEL.wontfix, " \u00B7 needs a human ").concat(FUNNEL.needsHuman, " \u00B7 deferred ").concat(FUNNEL.deferred, " \u00B7 harness ").concat(FUNNEL.harnessOpen, " \u00B7 untouched ").concat(FUNNEL.untouched), { size: 11, fill: MUTED });
    // the three sentences
    var ty = 270;
    b += text(x0, ty, "100 rows were the instrument, not the product. The pilot's ratio was 4 of 11.", { size: 13 });
    b += text(x0, ty + 22, "33 of the 50 closes happened the same day, by the walk's own workstream. The other 17 took a median of 6 days.", { size: 13 });
    b += text(x0, ty + 44, "Feature wishes: 7 filed, 0 closed. Decisions: 3 filed, 0 closed. No journey issue has ever used the manual-testing gate.", { size: 13 });
    return svg(W, H, "Claim-to-issue funnel", b);
}
// ---------------------------------------------------------------- 3. rounds grid
function roundsGrid() {
    var W = 960;
    var H = 400;
    var x0 = 150;
    var y0 = 80;
    var colW = (W - x0 - 30) / ROUNDS.length;
    var rowH = 52;
    var b = "";
    b += text(24, 34, "Nineteen walks: dot area is claim rows, orange is the harness share, number is new issues filed", { size: 16, weight: 600 });
    ROUNDS.forEach(function (r, i) { return b += text(x0 + colW * i + colW / 2, y0 - 22, r, { anchor: "middle", size: 13, weight: 600 }); });
    JOURNEYS.forEach(function (_a, ri) {
        var j = _a[0], name = _a[1];
        var cy = y0 + ri * rowH + rowH / 2;
        b += text(24, cy + 5, "".concat(j, "  ").concat(name), { size: 13 });
        b += line(x0 - 10, cy + rowH / 2, W - 30, cy + rowH / 2);
        var _loop_1 = function (c) {
            var ws = WALKS.filter(function (w) { return w.journey === j && w.round === c; });
            var slot = colW / (ws.length + 1);
            ws.forEach(function (w, k) {
                var cx = x0 + colW * c + slot * (k + 1);
                var r = Math.sqrt(w.rows) * 1.35;
                b += circle(cx, cy, r, BLUE, 'opacity="0.85"');
                var hr = Math.sqrt(w.harness) * 1.35;
                b += circle(cx, cy, hr, ORANGE);
                b += text(cx + r + 4, cy + 4, String(w.filed), { size: 12, weight: 600 });
                if (w.note)
                    b += text(cx, cy + r + 13, w.note, { anchor: "middle", size: 9.5, fill: MUTED });
            });
        };
        for (var c = 0; c < ROUNDS.length; c++) {
            _loop_1(c);
        }
    });
    // B's two Aug 23 pilots
    b += text(x0 + colW / 2, y0 + rowH + rowH / 2 + 32, "", { size: 9.5 });
    var ly = y0 + 5 * rowH + 24;
    b += circle(40, ly, Math.sqrt(100) * 1.35, BLUE, 'opacity="0.85"');
    b += text(60, ly + 4, "100 claim rows", { size: 12, fill: MUTED });
    b += circle(190, ly, Math.sqrt(10) * 1.35, ORANGE);
    b += text(203, ly + 4, "10 of them the harness, not the product", { size: 12, fill: MUTED });
    b += text(480, ly + 4, "Not drawn: two Aug 23 inventory pilots with no claim table, and a Sep 21 lending recovery pass.", { size: 11.5, fill: MUTED });
    b += text(24, ly + 34, "Oct 8 filed 43 issues; Oct 9 filed 23 and spent its rows re-checking the day before (73 re-encounter rows against 29).", { size: 12.5 });
    return svg(W, H, "Walks by journey and round", b);
}
// ---------------------------------------------------------------- 4. kinds
function kinds() {
    var W = 960;
    var H = 330;
    var x0 = 220;
    var y0 = 60;
    var rowH = 26;
    var max = Math.max.apply(Math, KINDS.map(function (_a) {
        var o = _a[1], c = _a[2];
        return o + c;
    }));
    var scale = (W - x0 - 120) / max;
    var b = "";
    b += text(24, 34, "What the 98 issues are, and which kinds close", { size: 18, weight: 600 });
    KINDS.forEach(function (_a, i) {
        var label = _a[0], open = _a[1], closed = _a[2];
        var y = y0 + i * rowH;
        b += text(x0 - 10, y + 15, label, { anchor: "end", size: 12.5 });
        var cw = closed * scale;
        var ow = open * scale;
        if (closed)
            b += rect(x0, y + 3, cw - (open ? 2 : 0), 16, AQUA, 'rx="3"');
        if (open)
            b += rect(x0 + cw, y + 3, ow, 16, "#c7cdd6", 'rx="3"');
        b += text(x0 + cw + ow + 8, y + 15, "".concat(closed, " closed \u00B7 ").concat(open, " open"), { size: 11.5, fill: MUTED });
    });
    var ly = y0 + KINDS.length * rowH + 22;
    b += rect(x0, ly - 10, 14, 12, AQUA, 'rx="2"');
    b += text(x0 + 20, ly, "closed", { size: 12, fill: MUTED });
    b += rect(x0 + 80, ly - 10, 14, 12, "#c7cdd6", 'rx="2"');
    b += text(x0 + 100, ly, "open", { size: 12, fill: MUTED });
    b += text(24, ly + 28, "Defects and wording close. Feature wishes never have. Assistant behavior closes only through guidance changes,", { size: 12.5 });
    b += text(24, ly + 46, "and the next walk saw three of the four Oct 9 guidance closes still present.", { size: 12.5 });
    return svg(W, H, "Issue kinds, open and closed", b);
}
// ---------------------------------------------------------------- 5. days to close
function daysToClose() {
    var _a;
    var W = 960;
    var H = 230;
    var x0 = 60;
    var axisY = 140;
    var scale = (W - x0 - 40) / 32;
    var b = "";
    b += text(24, 34, "Two speeds: days from filing to close, 50 closed issues", { size: 18, weight: 600 });
    b += line(x0, axisY, x0 + 32 * scale, axisY, RULE, 1);
    for (var _i = 0, _b = [0, 5, 10, 15, 20, 25, 30]; _i < _b.length; _i++) {
        var t = _b[_i];
        b += line(x0 + t * scale, axisY, x0 + t * scale, axisY + 5, MUTED, 1);
        b += text(x0 + t * scale, axisY + 20, String(t), { anchor: "middle", size: 11, fill: MUTED });
    }
    b += text(x0 + 32 * scale, axisY + 20, "days", { anchor: "end", size: 11, fill: MUTED });
    // stack dots per day
    var counts = new Map();
    for (var _c = 0, DAYS_TO_CLOSE_1 = DAYS_TO_CLOSE; _c < DAYS_TO_CLOSE_1.length; _c++) {
        var d = DAYS_TO_CLOSE_1[_c];
        var k = Math.max(d, 0);
        var n = (_a = counts.get(k)) !== null && _a !== void 0 ? _a : 0;
        var col = Math.floor(n / 11);
        var row = n % 11;
        var cx = x0 + k * scale + col * 9 - (k === 0 ? 9 : 0);
        var cy = axisY - 8 - row * 9;
        b += circle(cx, cy, 3.6, k === 0 ? AQUA : BLUE);
        counts.set(k, n + 1);
    }
    b += text(x0 + 30, 50, "33 same day", { size: 12.5, weight: 600, fill: AQUA });
    b += text(x0 + 30, 66, "the walk's own workstream fixes what it found", { size: 11.5, fill: MUTED });
    b += text(x0 + 9 * scale, 92, "17 later, median 6 days", { size: 12.5, weight: 600, fill: BLUE });
    b += text(x0 + 9 * scale, 108, "a planned workstream picks the issue up; the next walk confirms it", { size: 11.5, fill: MUTED });
    b += text(24, 190, "Nothing in between: no journey issue was closed by a pick-from-the-queue session, apart from two small batches.", { size: 12.5 });
    b += text(24, 208, "The 48 still open: 8 wait on a decision, 10 are deferred, 2 are harness, 28 are untriaged (neither October round has priorities).", { size: 12.5 });
    return svg(W, H, "Days from filing to close", b);
}
// ---------------------------------------------------------------- 6. stories
function stories() {
    var W = 960;
    var H = 330;
    var x0 = 320;
    var y0 = 70;
    var rowH = 40;
    var start = new Date("2026-08-20").getTime();
    var end = new Date("2026-10-12").getTime();
    var xOf = function (d) { return x0 + ((new Date("2026-".concat(d)).getTime() - start) / (end - start)) * (W - x0 - 30); };
    var b = "";
    b += text(24, 34, "Five issues, whole life", { size: 18, weight: 600 });
    for (var _i = 0, _a = ["08-25", "09-01", "09-15", "10-01", "10-08"]; _i < _a.length; _i++) {
        var m = _a[_i];
        b += line(xOf(m), y0 - 14, xOf(m), y0 + STORIES.length * rowH - 10, RULE);
        b += text(xOf(m), y0 - 20, m.replace("-", "/"), { anchor: "middle", size: 11, fill: MUTED });
    }
    STORIES.forEach(function (s, i) {
        var cy = y0 + i * rowH + 10;
        b += text(x0 - 12, cy + 4, s.name, { anchor: "end", size: 12.5 });
        var first = xOf(s.events[0].d);
        var last = xOf(s.events[s.events.length - 1].d);
        var endsOpen = s.events[s.events.length - 1].kind === "open";
        b += line(first, cy, last, cy, endsOpen ? RED : BLUE, 2, endsOpen ? 'stroke-dasharray="4 3"' : "");
        for (var _i = 0, _a = s.events; _i < _a.length; _i++) {
            var e = _a[_i];
            var x = xOf(e.d);
            switch (e.kind) {
                case "filed":
                    b += circle(x, cy, 5, BLUE);
                    break;
                case "re":
                    b += circle(x, cy, 5, PAPER, "stroke=\"".concat(BLUE, "\" stroke-width=\"2\""));
                    break;
                case "closed":
                    b += rect(x - 5, cy - 5, 10, 10, AQUA, 'rx="2"');
                    break;
                case "wontfix":
                    b += rect(x - 5, cy - 5, 10, 10, "#9fd9c3", 'rx="2"');
                    break;
                case "confirmed":
                    b += "<path d=\"M".concat(x - 5, " ").concat(cy, " l3.5 3.5 l6 -7\" fill=\"none\" stroke=\"").concat(AQUA, "\" stroke-width=\"2.2\"/>");
                    break;
                case "open":
                    b += text(x + 8, cy + 4, "open", { size: 11, fill: RED, weight: 600 });
                    break;
            }
        }
    });
    var ly = y0 + STORIES.length * rowH + 14;
    var leg = [
        ["filed", "filled dot"],
        ["re-encountered by a later walk", "ring"],
        ["closed", "square"],
        ["won't fix", "pale square"],
        ["next walk confirmed", "tick"],
    ];
    var lx = 24;
    for (var _b = 0, leg_1 = leg; _b < leg_1.length; _b++) {
        var _c = leg_1[_b], k = _c[0], shape = _c[1];
        if (shape === "filled dot")
            b += circle(lx + 5, ly, 5, BLUE);
        if (shape === "ring")
            b += circle(lx + 5, ly, 5, PAPER, "stroke=\"".concat(BLUE, "\" stroke-width=\"2\""));
        if (shape === "square")
            b += rect(lx, ly - 5, 10, 10, AQUA, 'rx="2"');
        if (shape === "pale square")
            b += rect(lx, ly - 5, 10, 10, "#9fd9c3", 'rx="2"');
        if (shape === "tick")
            b += "<path d=\"M".concat(lx, " ").concat(ly, " l3.5 3.5 l6 -7\" fill=\"none\" stroke=\"").concat(AQUA, "\" stroke-width=\"2.2\"/>");
        b += text(lx + 16, ly + 4, k, { size: 11.5, fill: MUTED });
        lx += 16 + k.length * 6.6 + 18;
    }
    b += text(24, ly + 30, "The openers issue was re-encountered by all six Oct 8 walks on their first screenshot, closed that day, and confirmed by all six Oct 9 walks.", { size: 12.5 });
    b += text(24, ly + 48, "The landmark-binding issue has been hit by three walks over 46 days and waits on a decision between three options.", { size: 12.5 });
    return svg(W, H, "Five issue lifelines", b);
}
// ---------------------------------------------------------------- 7. friction grid
function friction() {
    var W = 960;
    var H = 400;
    var x0 = 380;
    var y0 = 80;
    var colW = 120;
    var rowH = 30;
    var b = "";
    b += text(24, 34, "What keeps coming back: frictions by round", { size: 18, weight: 600 });
    ROUNDS.forEach(function (r, i) { return b += text(x0 + colW * i + colW / 2, y0 - 16, r, { anchor: "middle", size: 12.5, weight: 600 }); });
    FRICTION.forEach(function (_a, ri) {
        var label = _a[0], cells = _a[1];
        var y = y0 + ri * rowH;
        b += text(x0 - 12, y + 19, label, { anchor: "end", size: 12.5 });
        cells.forEach(function (c, ci) {
            var cx = x0 + colW * ci + colW / 2;
            var cy = y + 14;
            if (c === "h")
                b += circle(cx, cy, 8, BLUE);
            if (c === "p") {
                b += circle(cx, cy, 8, PAPER, "stroke=\"".concat(AQUA, "\" stroke-width=\"2\""));
                b += "<path d=\"M".concat(cx, " ").concat(cy - 8, " A8 8 0 0 1 ").concat(cx, " ").concat(cy + 8, " Z\" fill=\"").concat(AQUA, "\"/>");
            }
            if (c === "f")
                b += "<path d=\"M".concat(cx - 7, " ").concat(cy, " l5 5 l9 -10\" fill=\"none\" stroke=\"").concat(AQUA, "\" stroke-width=\"2.5\"/>");
        });
    });
    var ly = y0 + FRICTION.length * rowH + 22;
    b += circle(34, ly, 8, BLUE);
    b += text(50, ly + 4, "reported", { size: 12, fill: MUTED });
    b += circle(140, ly, 8, PAPER, "stroke=\"".concat(AQUA, "\" stroke-width=\"2\""));
    b += "<path d=\"M140 ".concat(ly - 8, " A8 8 0 0 1 140 ").concat(ly + 8, " Z\" fill=\"").concat(AQUA, "\"/>");
    b += text(156, ly + 4, "partly fixed", { size: 12, fill: MUTED });
    b += "<path d=\"M".concat(258, " ").concat(ly, " l5 5 l9 -10\" fill=\"none\" stroke=\"").concat(AQUA, "\" stroke-width=\"2.5\"/>");
    b += text(282, ly + 4, "fixed and confirmed by the next walk", { size: 12, fill: MUTED });
    b += text(24, ly + 34, "Each round's biggest complaint is fixed before the next; the fix brings a smaller defect in the surface that fixed it.", { size: 12.5 });
    b += text(24, ly + 52, "Oct 9's main defect, a root place page saying \"Nothing here yet\" beside a box full of cards, was introduced by the work that fixed the openers.", { size: 12.5 });
    return svg(W, H, "Recurring frictions by round", b);
}
// ---------------------------------------------------------------- write
(0, node_fs_1.mkdirSync)(OUT, { recursive: true });
var figures = [
    ["pipeline.svg", pipeline],
    ["funnel.svg", funnel],
    ["rounds.svg", roundsGrid],
    ["kinds.svg", kinds],
    ["days-to-close.svg", daysToClose],
    ["stories.svg", stories],
    ["friction.svg", friction],
];
for (var _i = 0, figures_1 = figures; _i < figures_1.length; _i++) {
    var _a = figures_1[_i], name_1 = _a[0], fn = _a[1];
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(OUT, name_1), fn());
    console.log("wrote figures/".concat(name_1));
}
