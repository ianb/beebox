/**
 * TourCard — renderer for `tour` cards (`docs/plans/conversation-strip.md`,
 * Track B). A tour is an ordered list of beats (`##` sections of the body)
 * with one named current by the `current` field.
 *
 * In the conversation strip it shows the beat titles in one row and the
 * selected beat's content below (`beat-selection.ts`). Elsewhere it shows
 * the introduction and every beat in order, with the current one marked.
 * Links go through `onNavigate`, so a card link opens beside the
 * conversation and a `control:` link points at the control.
 */

import { useState } from "react";
import { parseTourBeats, currentBeatIndex, type TourBeat } from "@shared/tour-beats";
import { Markdown } from "../Markdown/body";
import { Heading } from "../ui/Heading";
import { Badge } from "../ui/Badge";
import { Stack } from "../ui/Stack";
import { bbxSource } from "../../lib/source-tag";
import { selectedBeatIndex, tourCurrent, type BeatPick } from "./beat-selection";
import type { RendererProps } from "../../file-type-registry";

type Navigate = RendererProps["onNavigate"];

function BeatTitles({ beats, currentIndex, selected, onPick }: {
  beats: readonly TourBeat[]; currentIndex: number | null; selected: number | null; onPick: (title: string) => void;
}) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap gap-1">
      {beats.map((beat, index) => (
        <li key={beat.title}>
          <button type="button" aria-current={index === currentIndex ? "step" : undefined} aria-pressed={index === selected}
            onClick={() => onPick(beat.title)}
            className={`rounded px-2 py-0.5 text-xs border ${index === currentIndex ? "border-primary font-semibold text-primary-dark" : "border-warm-200 text-warm-700"} ${index === selected ? "bg-primary-50" : "bg-white hover:bg-warm-100"}`}>
            {beat.title}
          </button>
        </li>
      ))}
    </ol>
  );
}

function StripTour({ path, beats, introduction, current, onNavigate }: {
  path: string; beats: readonly TourBeat[]; introduction: string; current: string | undefined; onNavigate: Navigate;
}) {
  const [picked, setPicked] = useState<BeatPick | null>(null);
  const selected = selectedBeatIndex({ beats, current, picked });
  const beat = selected === null ? undefined : beats[selected];
  const markdown = beat === undefined ? introduction : beat.markdown;
  return (
    <Stack gap="sm" className="px-3 py-2">
      <BeatTitles beats={beats} currentIndex={currentBeatIndex(beats, current)} selected={selected} onPick={(title) => setPicked({ title, current })} />
      {markdown === "" ? null : <div className="text-sm"><Markdown prose="block" onNavigate={onNavigate} basePath={path}>{markdown}</Markdown></div>}
    </Stack>
  );
}

function FullTour({ path, beats, introduction, current, onNavigate }: {
  path: string; beats: readonly TourBeat[]; introduction: string; current: string | undefined; onNavigate: Navigate;
}) {
  const currentIndex = currentBeatIndex(beats, current);
  return (
    <Stack gap="md" className="bbx-card-content">
      {introduction === "" ? null : <Markdown prose="block" onNavigate={onNavigate} basePath={path}>{introduction}</Markdown>}
      {beats.map((beat, index) => (
        <section key={beat.title} aria-current={index === currentIndex ? "step" : undefined}>
          <Heading level={2}>
            {beat.title}
            {index === currentIndex ? <Badge tone="accent" size="sm" className="ml-2 align-middle">Current</Badge> : null}
          </Heading>
          {beat.markdown === "" ? null : <Markdown prose="block" onNavigate={onNavigate} basePath={path}>{beat.markdown}</Markdown>}
        </section>
      ))}
    </Stack>
  );
}

export function TourCard({ data, onNavigate, mode }: RendererProps) {
  const { introduction, beats } = parseTourBeats(data.body ?? "");
  const current = tourCurrent(data.frontmatter);
  const props = { path: data.path, beats, introduction, current, onNavigate };
  return (
    <div {...bbxSource("card", data.path)}>
      {mode === "strip" ? <StripTour {...props} /> : <FullTour {...props} />}
    </div>
  );
}
