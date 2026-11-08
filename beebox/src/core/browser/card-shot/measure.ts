/**
 * The measuring script for `bbx browser screenshot --card`
 * (docs/plans/agent-self-view.md, Track C). Runs in the page with `eval` and
 * returns one JSON string: where the card is, how much of it the browser
 * painted, what inside it is wider than its box, any view error it shows, and
 * whether part of it is still loading (`aria-busy`).
 *
 * It scrolls the card's scroll container to the top-left first: the app puts a
 * card in a panel that scrolls on its own, and only the painted part of an
 * element appears in a screenshot.
 */

import { z } from "zod";

/** Overflow findings reported, at most. */
const MAX_OVERFLOW = 10;

/** The script for one card panel, as an `eval` argument. */
export function measureScript(panelId: string): string {
  return `(()=>{
const panel=document.getElementById(${JSON.stringify(panelId)});
const el=panel&&panel.querySelector(':scope > article');
if(!el)return JSON.stringify({found:false,url:location.href,title:document.title});
const clips=(e)=>/(auto|scroll|hidden|clip)/.test(getComputedStyle(e).overflowX+' '+getComputedStyle(e).overflowY);
let sc=el.parentElement;while(sc&&sc!==document.body&&!clips(sc))sc=sc.parentElement;
if(sc&&sc!==document.body){sc.scrollTop=0;sc.scrollLeft=0;}
const r=el.getBoundingClientRect();
const c=sc&&sc!==document.body?sc.getBoundingClientRect():{left:0,top:0,right:innerWidth,bottom:innerHeight};
const left=Math.max(r.left,c.left,0),top=Math.max(r.top,c.top,0);
const right=Math.min(r.right,c.right,innerWidth),bottom=Math.min(r.bottom,c.bottom,innerHeight);
const inClip=(e)=>{for(let a=e.parentElement;a&&a!==el;a=a.parentElement){if(/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX))return true;}return false;};
const cands=[...el.querySelectorAll('*')].filter((e)=>{const s=getComputedStyle(e);if(s.overflowX!=='visible'||inClip(e))return false;const b=e.getBoundingClientRect();return b.width>0&&(e.scrollWidth>e.clientWidth+1||b.right>r.right+1);});
const leaves=cands.filter((e)=>!cands.some((o)=>o!==e&&e.contains(o)));
const overflow=leaves.slice(0,${String(MAX_OVERFLOW)}).map((e)=>({tag:e.tagName.toLowerCase(),text:(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40),excess:Math.round(Math.max(e.scrollWidth-e.clientWidth,e.getBoundingClientRect().right-r.right))}));
const alert=el.querySelector('[role=alert]');
const busy=el.querySelector('[aria-busy=true]')!==null;
return JSON.stringify({found:true,url:location.href,card:{width:r.width,height:r.height},painted:{x:left-r.left,y:top-r.top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)},viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,overflow,errorText:alert?(alert.textContent||'').replace(/\\s+/g,' ').trim().slice(0,300):null,busy});
})()`;
}

const Box = z.object({ width: z.number(), height: z.number() });

export const MEASURE = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false), url: z.string(), title: z.string() }),
  z.object({
    found: z.literal(true),
    url: z.string(),
    card: Box,
    painted: Box.extend({ x: z.number(), y: z.number() }),
    viewport: Box,
    dpr: z.number().positive(),
    overflow: z.array(z.object({ tag: z.string(), text: z.string(), excess: z.number() })),
    errorText: z.string().nullable(),
    /** Part of the card still shows a loading state (`aria-busy`). */
    busy: z.boolean(),
  }),
]);
export type Measure = z.infer<typeof MEASURE>;
export type FoundMeasure = Extract<Measure, { found: true }>;

/** The measure in `eval`'s whole output (a JSON string holding JSON), or null. */
export function parseMeasure(stdout: string): Measure | null {
  try {
    const outer: unknown = JSON.parse(stdout);
    if (typeof outer !== "string") return null;
    const parsed = MEASURE.safeParse(JSON.parse(outer));
    return parsed.success ? parsed.data : null;
  } catch (_e) {
    // Output cut off or not the script's: the caller reports it.
    return null;
  }
}
