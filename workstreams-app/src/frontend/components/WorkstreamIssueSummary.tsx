import { Link } from "@tanstack/react-router";
import { Pill } from "./ui.js";
import type { Issue } from "../types.js";

export function WorkstreamIssueSummary({ issue, owned, discovered, activity }: { issue: Issue; owned: boolean; discovered: boolean; activity?: "opened" | "updated" | "closed" | "reopened" }) {
  const manual = issue.frontmatter.needs.includes("manual-testing");
  return <Link className={`workstream-issue ${manual ? "workstream-issue-manual" : ""}`} to="/issues" search={{ issue: issue.relPath }}>
    <span className="issue-association"><span className={`association-owned ${owned ? "" : "association-inactive"}`}>Owns</span><span className={`association-discovered ${discovered ? "" : "association-inactive"}`}>Discovered</span></span>
    <span className="workstream-issue-copy"><span>{issue.frontmatter.title}</span><small>{manual ? "Manual testing · " : ""}{issue.closed ? "Closed" : "Open"}{activity ? ` · ${activity} here` : ""}{issue.frontmatter.discoveredBy ? ` · Discovered by ${issue.frontmatter.discoveredBy}` : ""}</small></span>
    <Pill tone={issue.frontmatter.priority === "important" ? "danger" : issue.frontmatter.priority === "backlog" ? "info" : "neutral"}>{issue.frontmatter.priority}</Pill>
  </Link>;
}
