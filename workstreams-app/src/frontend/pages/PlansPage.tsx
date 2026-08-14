import { Link } from "@tanstack/react-router";
import { Button } from "../components/ui.js";
import { trpc } from "../trpc.js";
import type { Plan } from "../types.js";

const STATUSES = ["draft", "active", "partial", "implemented", "superseded", "parked"];

export function PlansList({ plans }: { plans: Plan[] }) {
  return <main className="simple-page"><h1>plans</h1>{STATUSES.map((status) => { const matching = plans.filter((plan) => plan.status === status); return matching.length > 0 ? <section key={status}><h2>{status} <small>{matching.length}</small></h2><ul className="document-list">{matching.map((plan) => <li key={plan.relPath}><a href={`/main/dev/docs/${plan.relPath.replace(/^callback-box\//, "")}`}>{plan.title}</a><Link to="/workstreams/$name" params={{ name: plan.workstream }}>{plan.workstream}</Link></li>)}</ul></section> : null; })}{plans.length === 0 ? <p className="empty-state">No plans found.</p> : null}</main>;
}

export function PlansPage() {
  const plans = trpc.plans.list.useQuery();
  if (plans.isLoading) return <main className="simple-page"><section className="loading-skeleton" aria-busy="true"><span /><span /></section></main>;
  if (plans.isError) return <main className="simple-page"><section className="error-state"><p>Couldn’t load plans: {plans.error.message}</p><Button onClick={() => void plans.refetch()}>Retry</Button></section></main>;
  return <PlansList plans={plans.data?.items ?? []} />;
}
