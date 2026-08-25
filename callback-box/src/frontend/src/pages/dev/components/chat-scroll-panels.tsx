/**
 * Observability panels for the dev scroll harness (/dev/chat-scroll): the live
 * scroll-geometry readout with the last run's PASS/FAIL, and the event log.
 * Presentational only — every value arrives as a prop.
 */

import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Pre } from "../../../components/ui/Pre";
import { Row } from "../../../components/ui/Row";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";
import type { RunSummary } from "./chat-scroll-runner";
import { SCENARIOS } from "./chat-scroll-scenarios";

/** One recorded moment: a scroll event, a controller trace event, or a step. */
export interface LogEntry {
  t: number;
  kind: string;
  detail: Record<string, string | number | boolean>;
}

const READOUT_HZ = 10;

interface Geometry {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  fromBottom: number;
}

interface ReadoutProps {
  scroller: MutableRefObject<HTMLDivElement | null>;
  atBottom: boolean;
  unseen: boolean;
  summary: RunSummary | null;
}

export function HarnessReadout({ scroller, atBottom, unseen, summary }: ReadoutProps) {
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  useEffect(() => {
    const tick = (): void => {
      const el = scroller.current;
      if (!el) {
        setGeometry(null);
        return;
      }
      setGeometry({
        scrollTop: Math.round(el.scrollTop),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        fromBottom: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
      });
    };
    tick();
    const timer = window.setInterval(tick, Math.round(1000 / READOUT_HZ));
    return () => window.clearInterval(timer);
  }, [scroller]);

  return (
    <Stack gap="xs">
      <Text as="h2" size="sm" weight="bold" uppercase>Readout</Text>
      <Row gap="sm" wrap align="center">
        <Text size="sm" mono>
          scrollTop {geometry ? geometry.scrollTop : "—"} · scrollHeight {geometry ? geometry.scrollHeight : "—"}
          {" · "}clientHeight {geometry ? geometry.clientHeight : "—"} · fromBottom {geometry ? geometry.fromBottom : "—"}
        </Text>
        <Badge tone={atBottom ? "success" : "neutral"}>atBottom {String(atBottom)}</Badge>
        <Badge tone={unseen ? "warning" : "neutral"}>hasUnseenContent {String(unseen)}</Badge>
      </Row>
      {summary ? <SummaryPanel summary={summary} /> : <Text size="sm" tone="muted">No run yet.</Text>}
    </Stack>
  );
}

function SummaryPanel({ summary }: { summary: RunSummary }) {
  return (
    <Stack gap="xs">
      <Row gap="sm" align="center">
        <Badge tone={summary.pass ? "success" : "danger"}>{summary.pass ? "PASS" : "FAIL"}</Badge>
        <Text size="sm" weight="medium">{summary.scenario}</Text>
        <Text size="sm" tone="muted">{summary.durationMs}ms</Text>
      </Row>
      <Pre boxed size="xs">{JSON.stringify(summary, null, 2)}</Pre>
    </Stack>
  );
}

const LOG_TAIL = 300;

export function HarnessLog({ entries }: { entries: LogEntry[] }) {
  const tail = entries.slice(-LOG_TAIL);
  return (
    <Stack gap="xs">
      <Text as="h2" size="sm" weight="bold" uppercase>Event log ({entries.length} events, last {tail.length})</Text>
      {tail.length === 0 ? (
        <Text size="sm" tone="muted">Empty — run a scenario or scroll the frame.</Text>
      ) : (
        <Pre boxed scroll="lg" size="xs">{tail.map(formatEntry).join("\n")}</Pre>
      )}
    </Stack>
  );
}

function formatEntry(entry: LogEntry): string {
  const detail = Object.entries(entry.detail)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  return `${String(entry.t).padStart(6, " ")}  ${entry.kind.padEnd(18, " ")} ${detail}`;
}

/** Scenario launchers. Each button drives the same public API bin/browse uses. */
export function HarnessToolbar({ running, onReset }: { running: string | null; onReset: () => void }) {
  return (
    <Row gap="sm" wrap>
      {SCENARIOS.map((s) => (
        <Button
          key={s.name}
          id={`cb-chat-scroll-run-${s.name}`}
          size="sm"
          intent="secondary"
          disabled={running !== null}
          title={s.description}
          onClick={() => { void window.__scrollHarness?.run(s.name); }}
        >
          {s.name}
        </Button>
      ))}
      <Button id="cb-chat-scroll-reset" size="sm" intent="ghost" onClick={onReset}>Reset</Button>
      {running === null ? null : <Badge tone="info">running {running}</Badge>}
    </Row>
  );
}

interface StatusRowProps {
  atBottom: boolean;
  unseen: boolean;
  onScrollToBottom: (opts?: { behavior?: ScrollBehavior }) => void;
}

/** The chat's own scroll-to-bottom affordance, driven by the same two flags. */
export function HarnessStatusRow({ atBottom, unseen, onScrollToBottom }: StatusRowProps) {
  return (
    <Row gap="sm" align="center">
      <Button
        id="cb-chat-scroll-to-bottom"
        size="sm"
        intent={unseen ? "accent" : "secondary"}
        onClick={() => onScrollToBottom({ behavior: "smooth" })}
      >
        Scroll to bottom
      </Button>
      <Badge tone={atBottom ? "success" : "neutral"}>{atBottom ? "at bottom" : "away"}</Badge>
      <Badge tone={unseen ? "warning" : "neutral"}>{unseen ? "unseen content" : "no unseen content"}</Badge>
    </Row>
  );
}
