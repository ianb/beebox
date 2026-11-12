// # `bbx view check` advice: the DOM rules
//
// `domAdvice(container)` reads one settled render (rebuilt in jsdom from the
// render child's snapshot) and reports what the markup proves: unnamed
// controls, images with no `alt`, `aria-label` with no role, and wide tables
// with nothing that scrolls them. Hidden and inert subtrees are skipped by
// the naming rules; only hidden ones by the table rule.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { JSDOM, VirtualConsole } from "jsdom";
import { domAdvice, horizontalOverflow } from "../../../src/core/views/advice/dom.js";

/** Each finding as `<rule> <opening tag>`, for `html` rendered with `css` in the head. */
function findings(html: string, css?: string): string[] {
  const dom = new JSDOM(`<!doctype html><html><head><style>${css ?? ""}</style></head><body><div>${html}</div></body></html>`, { virtualConsole: new VirtualConsole() });
  const container = dom.window.document.body.firstElementChild;
  if (container === null) throw new Error("no container");
  return domAdvice(container).flatMap((a) => a.where.map((w) => `${a.rule} ${w}`));
}

const ROW4 = "<tr><td>1</td><td>2</td><td>3</td><td>4</td></tr>";
const TABLE4 = `<table>${ROW4}</table>`;

void test("unnamed-control: controls with nothing that names them", async (t) => {
  t.check(findings(`
<button></button>
<button><svg><path d="M0"/></svg></button>
<a href="/x"></a>
<input placeholder="Message">
<textarea></textarea>
<select></select>
<button>Save</button>
<button aria-label="Close"></button>
<button><img alt="Close"></button>
<button><span role="img" aria-label="Close"></span></button>
<button><svg><title>Close</title></svg></button>
<a href="/x" title="Home"></a>
<a></a>
<label>Due <input type="date"></label>
<label for="q">Search</label><input id="q">
<input type="hidden"><input type="submit"><input type="button" value="Go">
<input aria-labelledby="nowhere">
<button aria-label=""></button>
`), [
    "unnamed-control <button>",
    "unnamed-control <button>",
    "unnamed-control <a href=\"/x\">",
    "unnamed-control <input placeholder=\"Message\">",
    "unnamed-control <textarea>",
    "unnamed-control <select>",
  ]);
});

void test("img-without-alt and aria-label-without-role", async (t) => {
  t.check(findings(`
<img src="a.png">
<img src="b.png" alt="">
<img src="c.png" role="presentation">
<div aria-label="Totals">1</div>
<div role="group" aria-label="Totals">2</div>
<section aria-label="Totals">3</section>
`), ["img-without-alt <img src=\"a.png\">", "aria-label-without-role <div aria-label=\"Totals\">"]);
});

// Not shown: hidden, display none, closed dialog, closed details outside its
// summary. Not exposed: aria-hidden, inert.
void test("the naming rules skip what is not shown or not exposed", async (t) => {
  t.check(findings(`
<div hidden><button></button></div>
<div class="gone"><img src="a.png"></div>
<dialog><button></button></dialog>
<details><summary><button class="s"></button></summary><button class="c"></button></details>
<details open><button class="o"></button></details>
<div aria-hidden="true"><button></button></div>
<div inert><div aria-label="x"></div></div>
`, ".gone { display: none }"), ["unnamed-control <button class=\"s\">", "unnamed-control <button class=\"o\">"]);
});

void test("wide-table-without-wrapper: 4 or more cells and nothing that scrolls", async (t) => {
  t.check(findings(`
<table class="a">${ROW4}</table>
<table class="b"><tr><td>1</td><td>2</td><td>3</td></tr></table>
<div style="overflow-x: auto"><table class="c">${ROW4}</table></div>
<div class="wrap"><div><table class="d">${ROW4}</table></div></div>
<div class="overflow-x-auto"><table class="e">${ROW4}</table></div>
<table class="f" style="display: block; overflow-x: scroll">${ROW4}</table>
<table class="g"><tr><td><table>${ROW4}</table></td></tr></table>
<table class="h" style="overflow-x: auto">${ROW4}</table>
<table class="i overflow-x-auto">${ROW4}</table>
<table class="j block overflow-x-auto">${ROW4}</table>
`, ".wrap { overflow-x: auto }"), [
    "wide-table-without-wrapper <table class=\"a\">",
    "wide-table-without-wrapper <table>",
    "wide-table-without-wrapper <table class=\"h\" style=\"overflow-x: auto\">",
    "wide-table-without-wrapper <table class=\"i overflow-x-auto\">",
  ]);
});

// A table hidden from assistive technology still paints past the card; one
// not shown does not.
void test("the table rule skips only what is not shown", async (t) => {
  t.check(findings(`<div aria-hidden="true">${TABLE4}</div><div inert>${TABLE4}</div><div hidden>${TABLE4}</div>`), [
    "wide-table-without-wrapper <table>",
    "wide-table-without-wrapper <table>",
  ]);
});

// The x axis is `overflow-x` when set, else the shorthand's first value.
void test("horizontal overflow honors overflow-x over the shorthand", async (t) => {
  t.check([
    findings(`<div style="overflow: auto; overflow-x: hidden">${TABLE4}</div>`),
    findings(`<div style="overflow: auto hidden">${TABLE4}</div>`),
    findings(`<div style="overflow: auto">${TABLE4}</div>`),
    // A browser scrolls this one; jsdom keeps `overflow-x: hidden`, so the
    // rule advises a table that is already wrapped (a documented limit).
    findings(`<div style="overflow-x: hidden; overflow: auto">${TABLE4}</div>`),
  ], [["wide-table-without-wrapper <table>"], [], [], ["wide-table-without-wrapper <table>"]]);
  t.check([
    horizontalOverflow({ overflowX: "scroll", overflow: "hidden" }),
    horizontalOverflow({ overflowX: "", overflow: "auto hidden" }),
    horizontalOverflow({ overflowX: "", overflow: "" }),
  ], ["scroll", "auto", ""]);
});

void test("a long opening tag is cut to 60 characters", async (t) => {
  t.check(findings(`<img src="${"x".repeat(80)}.png">`), [`img-without-alt <img src="${"x".repeat(49)}…`]);
});
