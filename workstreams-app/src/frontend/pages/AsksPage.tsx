import { Button, Pill } from "../components/ui.js";
import { groupAskQueue } from "../lib/ask-queue.js";
import { friendlyTimestamp } from "../lib/format.js";
import { trpc } from "../trpc.js";
import { askTypeLabels, type AskQueue, type AskQueueEntry, type AskType } from "../types.js";

const GROUP_PROSE: Record<AskType, string> = {
  decide: "Pick among the options the agent enumerated.",
  confirm: "Veto if this is wrong; silence is not consent, but it is cheap.",
  react: "Freeform impressions wanted.",
  fyi: "Nothing needed — shown so it is not lost.",
};

function entryHref(queue: AskQueue, entry: AskQueueEntry): string {
  return `${queue.origin}${entry.path}`;
}

function AskItem({ queue, entry }: { queue: AskQueue; entry: AskQueueEntry }) {
  return (
    <li className="ask-item">
      <div className="ask-item-head">
        {/* No token in the link: the browser may already hold the exhibits
            cookie, and a 401 that prints the bin/exhibits hint is safer than
            copying the token into this page. */}
        <a href={entryHref(queue, entry)}>{entry.title ?? entry.slug}</a>
        {entry.permanent ? <Pill tone="info">app</Pill> : null}
        <span className="muted ask-item-scope">{entry.workstream}/{entry.slug}</span>
      </div>
      {entry.ask ? <p className="ask-item-prose">{entry.ask.prose}</p> : null}
      {entry.ask?.options ? <p className="muted ask-item-options">{entry.ask.options.join(" · ")}</p> : null}
      {entry.problem === null ? null : <p className="action-error" role="alert">{entry.problem}</p>}
    </li>
  );
}

function AskGroupSection({ queue, type, entries }: { queue: AskQueue; type: AskType; entries: AskQueueEntry[] }) {
  return (
    <section>
      <h2>{askTypeLabels[type]} <small>{entries.length}</small></h2>
      <p className="muted">{GROUP_PROSE[type]}</p>
      <ul className="document-list">
        {entries.map((entry) => <AskItem key={entry.path} queue={queue} entry={entry} />)}
      </ul>
    </section>
  );
}

export function AskQueueView({ queue }: { queue: AskQueue }) {
  const { groups, waitingCount, fyi, broken, answered } = groupAskQueue(queue);
  return (
    <main className="simple-page">
      <h1>waiting on you <small>{waitingCount}</small></h1>
      {queue.storeProblem === null ? null : <p className="error-state">{queue.storeProblem}</p>}
      {groups.map((group) => (
        <AskGroupSection key={group.type} queue={queue} type={group.type} entries={group.entries} />
      ))}
      {waitingCount === 0 ? <p className="empty-state">Nothing waiting on you.</p> : null}
      {fyi.length > 0 ? (
        <details className="ask-fyi">
          <summary>{askTypeLabels.fyi} <small>{fyi.length}</small></summary>
          <ul className="document-list">
            {fyi.map((entry) => <AskItem key={entry.path} queue={queue} entry={entry} />)}
          </ul>
        </details>
      ) : null}
      {broken.length > 0 ? (
        <section>
          <h2>Broken manifests <small>{broken.length}</small></h2>
          <ul className="document-list">
            {broken.map((entry) => <AskItem key={entry.path} queue={queue} entry={entry} />)}
          </ul>
        </section>
      ) : null}
      {answered.length > 0 ? (
        <section>
          <h2>Recently answered <small>{answered.length}</small></h2>
          <ul className="document-list">
            {answered.map((entry) => (
              <li key={entry.path}>
                <a href={entryHref(queue, entry)}>{entry.title ?? entry.slug}</a>
                <span className="muted">{entry.decidedAt === null ? "answered" : friendlyTimestamp(entry.decidedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

export function AsksPage() {
  const asks = trpc.exhibits.askQueue.useQuery();
  if (asks.isLoading) {
    return <main className="simple-page"><section className="loading-skeleton" aria-busy="true"><span /><span /></section></main>;
  }
  if (asks.isError || asks.data === undefined) {
    const message = asks.error?.message ?? "No queue returned.";
    return (
      <main className="simple-page">
        <section className="error-state">
          <p>Couldn’t load the ask queue: {message}</p>
          <Button onClick={() => void asks.refetch()}>Retry</Button>
        </section>
      </main>
    );
  }
  return <AskQueueView queue={asks.data} />;
}
