/**
 * Briefing-vocabulary tag components.
 *
 * Five tags moved from briefing frontmatter fields to body Markdoc:
 * `{% purpose %}`, `{% key-person %}`, `{% correction %}`,
 * `{% property %}`, `{% project-phase %}`. Each renders as a compact
 * styled block in the React renderer; the backend
 * `compileBriefing` emitter produces the parallel markdown shape
 * (`**Label:** …`) that lands in the @-included CLAUDE.md slice.
 *
 * Tags shipped here are intentionally minimal — small label + content,
 * subtle border accent. Briefings are reference material; ostentatious
 * styling would compete with the actual prose.
 */

import type { ReactNode } from "react";
import type { NavigateHint, ViewTarget } from "../lib/view-url";

export interface BriefingLinkContext {
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}

function LabeledBlock({
  label,
  meta,
  children,
}: {
  label: string;
  meta?: ReactNode;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="my-2">
      <span className="text-warm-500 text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
      {meta !== undefined ? <span className="text-warm-500 text-xs ml-1">{meta}</span> : null}
      <div className="text-warm-800 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}

function refToViewTarget(sourceRef: string): ViewTarget {
  const noFrag = sourceRef.split("#")[0] ?? sourceRef;
  const path = noFrag.replace(/^\/+/, "");
  return { path, viewer: null, params: {} };
}

function personDisplay(sourceRef: string | undefined, called: string | undefined): string {
  if (called !== undefined && called !== "") return called;
  if (sourceRef === undefined || sourceRef === "") return "(unknown)";
  const noFrag = sourceRef.split("#")[0] ?? sourceRef;
  const basename = noFrag.includes("/")
    ? noFrag.slice(noFrag.lastIndexOf("/") + 1)
    : noFrag;
  const stripped = basename.replace(/\.[^.]+\.card$/, "");
  return stripped.replace(/[_-]+/g, " ").trim() || sourceRef;
}

export function makeBriefingComponents(linkCtx: BriefingLinkContext) {
  function Purpose({ children }: { children?: ReactNode }) {
    return <LabeledBlock label="Purpose">{children}</LabeledBlock>;
  }

  function KeyPerson({
    sourceRef,
    called,
    role,
    children,
  }: {
    sourceRef?: string;
    called?: string;
    role?: string;
    children?: ReactNode;
  }) {
    const name = personDisplay(sourceRef, called);
    const nameNode = sourceRef !== undefined && sourceRef !== "" ? (
      <button
        type="button"
        onClick={() => linkCtx.onNavigate(refToViewTarget(sourceRef), { label: name })}
        className="text-warm-700 hover:text-warm-900 underline-offset-2 hover:underline cursor-pointer font-medium"
      >
        {name}
      </button>
    ) : (
      <span className="text-warm-700 font-medium">{name}</span>
    );
    const meta = role !== undefined && role !== ""
      ? <>{nameNode}<span className="text-warm-500"> — {role}</span></>
      : nameNode;
    return <LabeledBlock label="Key Person" meta={meta}>{children}</LabeledBlock>;
  }

  function Correction({
    test,
    children,
  }: {
    test?: string;
    children?: ReactNode;
  }) {
    const meta = test !== undefined && test !== ""
      ? <span className="italic">test: {test}</span>
      : undefined;
    return <LabeledBlock label="Correction" meta={meta}>{children}</LabeledBlock>;
  }

  function Property({
    name,
    address,
    addressUncertain,
    children,
  }: {
    name?: string;
    address?: string;
    addressUncertain?: boolean;
    children?: ReactNode;
  }) {
    const heading = name ?? address ?? "(unnamed)";
    const addr = address !== undefined && address !== name
      ? <> — {address}{addressUncertain === true ? <span className="italic"> (uncertain)</span> : null}</>
      : null;
    const meta = <><span className="font-medium text-warm-700">{heading}</span>{addr}</>;
    return <LabeledBlock label="Property" meta={meta}>{children}</LabeledBlock>;
  }

  function ProjectPhase({ date, children }: { date?: string; children?: ReactNode }) {
    const meta = date !== undefined && date !== "" ? <span>{date}</span> : undefined;
    return <LabeledBlock label="Current Phase" meta={meta}>{children}</LabeledBlock>;
  }

  return { Purpose, KeyPerson, Correction, Property, ProjectPhase };
}
