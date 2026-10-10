import { friendlyTimestamp } from "../lib/format.js";
import type { ExhibitInventoryEntry } from "../../shared/exhibits.js";

/**
 * Links to a workstream's exhibits on the exhibits origin. The links carry no
 * token: the browser holds the origin's cookie after one visit, and the 401
 * page names `bin/exhibits url`.
 */
export function ExhibitLinks({ entries, origin, dated }: { entries: ExhibitInventoryEntry[]; origin: string; dated?: boolean }) {
  return <ul className="exhibit-links">{entries.map((entry) => <li key={entry.slug}>
    {entry.title === null
      ? <><a href={`${origin}${entry.path}`}>{entry.slug}</a> <span className="muted">{entry.problem}</span></>
      : <><a href={`${origin}${entry.path}`}>{entry.title}</a>{dated && entry.created !== null ? <> <small className="muted">{friendlyTimestamp(entry.created)}</small></> : null}</>}
  </li>)}</ul>;
}

/** The link to every exhibit of one workstream on the exhibits origin. */
export function AllExhibitsLink({ workstream, origin }: { workstream: string; origin: string }) {
  return <a className="exhibits-all" href={`${origin}/${encodeURIComponent(workstream)}/`}>all exhibits</a>;
}
