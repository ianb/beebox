/**
 * The merged activity surface: every landmark in the box, each with its
 * chats *and* its links, plus a trailing bucket for chats bound to a
 * directory with no landmark. Self-sufficient (fetches its own data), so it
 * serves both the /landmarks page and `view: landmarks` cards
 * (docs/plans/interface-as-cards.md) — a `view: landmarks` card shows the
 * sessions too, which is the point: one full picture of the box's activity
 * (docs/plans/top-nav-ia.md Track D).
 *
 * Two queries: `landmarks.list` for link data, `chat.byLandmark` for the
 * chat buckets, joined by directory. Order and nesting come from `list`
 * (root first, then lexicographic by dir, depth-indented) — the page is
 * the box's MAP, grouped by directory; recency ordering belongs to the app
 * bar's switch menu, not here.
 *
 * See docs/landmarks.md.
 */

import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import type { RouterOutput } from "../../lib/trpc";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { LandmarkSection } from "./LandmarkSection";
import { LandmarkSessions } from "./LandmarkSessions";

type LandmarkRow = RouterOutput["landmarks"]["list"]["landmarks"][number];
type ChatBucket = RouterOutput["chat"]["byLandmark"]["landmarks"][number];

/**
 * Pair each of `list`'s rows with its chat bucket, keeping `list`'s ORDER —
 * root first, then lexicographic by dir, so each landmark follows its
 * nearest landmark ancestor and the page reads as the box's map (the
 * activity ordering that briefly replaced this scattered related landmarks;
 * recency lives in the app bar's switch menu, not here). A directory is
 * supposed to hold one landmark card — but nothing enforces it, so the join
 * keeps a queue per directory and consumes it: two cards in one directory
 * each take one of that directory's buckets instead of one silently
 * vanishing.
 */
function joinByDir(
  landmarks: LandmarkRow[],
  buckets: ChatBucket[],
): { landmark: LandmarkRow; bucket: ChatBucket | null }[] {
  const byDir = new Map<string, ChatBucket[]>();
  for (const bucket of buckets) {
    const queue = byDir.get(bucket.dir);
    if (queue) queue.push(bucket);
    else byDir.set(bucket.dir, [bucket]);
  }
  return landmarks.map((landmark) => ({
    landmark,
    bucket: byDir.get(landmark.dir)?.shift() ?? null,
  }));
}

export function LandmarksList() {
  const { boxSlug } = useParams({ strict: false });
  const slug = boxSlug ?? "";
  const list = trpc.landmarks.list.useQuery();
  const chats = trpc.chat.byLandmark.useQuery();

  if (list.isLoading || chats.isLoading) {
    return <Text as="div" tone="subtle" className="p-8">Loading…</Text>;
  }
  const error = list.error ?? chats.error;
  if (error) {
    return (
      <Text as="div" tone="subtle" className="p-8">
        Failed to load landmarks: {error.message}
      </Text>
    );
  }

  const landmarks = list.data ? list.data.landmarks : [];
  const buckets = chats.data ? chats.data.landmarks : [];
  const unassigned = chats.data ? chats.data.unassigned : null;
  const hasUnassigned =
    unassigned !== null && (unassigned.sessions.length > 0 || unassigned.olderSessions.length > 0);

  // Both readers glob the same cards, so the same broken card is reported
  // twice; the page names each one once (keyed on kind+path — a
  // "derived-read" and a "landmark-parse" can legitimately share a path).
  const problems = [
    ...new Map(
      [...(list.data ? list.data.problems : []), ...(chats.data ? chats.data.problems : [])].map(
        (p) => [`${p.kind}:${p.path}`, p] as const,
      ),
    ).values(),
  ].toSorted((a, b) => a.path.localeCompare(b.path));

  if (landmarks.length === 0 && !hasUnassigned && problems.length === 0) {
    return (
      <Text as="p" tone="subtle">
        No landmarks yet. Add a *.landmark.card to any directory you
        want to surface here.
      </Text>
    );
  }

  return (
    <Stack gap="md">
      {problems.length > 0 ? <LandmarkProblems problems={problems} /> : null}

      {joinByDir(landmarks, buckets).map(({ landmark, bucket }) => (
        <LandmarkSection
          key={landmark.path}
          landmark={landmark}
          boxSlug={slug}
          sessions={bucket}
        />
      ))}

      {/*
       * Chats bound to a directory with no landmark card — the box root
       * before anyone made a root landmark, or a dir whose landmark was
       * deleted. Last, because it's the leftovers; "New chat" here binds to
       * the root, the one directory that always exists.
       */}
      {hasUnassigned ? (
        <Card padding="md" border="subtle" shadow>
          <Stack gap="md">
            <div className="flex items-center gap-3">
              <span className="text-4xl leading-none flex-shrink-0" aria-hidden>💬</span>
              <Stack gap="xs">
                <Text as="h2" size="lg" weight="bold">Other chats</Text>
                <Text as="span" size="xs" tone="muted">
                  Chats whose directory has no landmark
                </Text>
              </Stack>
            </div>
            <LandmarkSessions
              bucket={{
                dir: "",
                sessions: unassigned.sessions,
                olderSessions: unassigned.olderSessions,
              }}
              boxSlug={slug}
            />
          </Stack>
        </Card>
      ) : null}
    </Stack>
  );
}

/**
 * Landmark cards that exist but don't parse. Named at the top of the page
 * rather than skipped: once a landmark is how you reach its chats, a
 * hand-edit that breaks the frontmatter must not make it vanish silently.
 */
type LandmarkProblemRow = RouterOutput["landmarks"]["list"]["problems"][number];

function problemText(problem: LandmarkProblemRow): string {
  switch (problem.kind) {
    case "landmark-parse":
      return `⚠ ${problem.path} didn’t parse — not shown`;
    case "derived-read":
      return `⚠ ${problem.path} (linked from ${problem.landmarkPath}) couldn’t be read — skipped`;
  }
}

function LandmarkProblems({ problems }: { problems: LandmarkProblemRow[] }) {
  return (
    <Card padding="sm" border="subtle" muted>
      <Stack gap="xs">
        {problems.map((problem) => (
          <Text key={`${problem.kind}:${problem.path}`} as="div" size="sm" breakAll>
            {problemText(problem)}
          </Text>
        ))}
      </Stack>
    </Card>
  );
}
