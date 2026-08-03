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
 * chat buckets, joined by directory. Order comes from `byLandmark` (latest
 * activity first, then chat-less landmarks with root ahead of alphabetical)
 * — this page doesn't re-sort, so the switch menu and this list agree.
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
 * Order `list`'s rows the way `byLandmark` orders its buckets, pairing each
 * with its chats. A landmark in `list` but not in `byLandmark` shouldn't
 * happen (both glob the same cards) — if it does it lands at the end,
 * alphabetically, rather than disappearing.
 */
function joinByDir(
  landmarks: LandmarkRow[],
  buckets: ChatBucket[],
): { landmark: LandmarkRow; bucket: ChatBucket | null }[] {
  const byDir = new Map(landmarks.map((lm) => [lm.dir, lm]));
  const paired: { landmark: LandmarkRow; bucket: ChatBucket | null }[] = [];
  for (const bucket of buckets) {
    const landmark = byDir.get(bucket.dir);
    if (landmark === undefined) continue;
    byDir.delete(bucket.dir);
    paired.push({ landmark, bucket });
  }
  const leftovers = [...byDir.values()].toSorted((a, b) => a.dir.localeCompare(b.dir));
  return [...paired, ...leftovers.map((landmark) => ({ landmark, bucket: null }))];
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
  // twice; the page names each one once.
  const problemPaths = [
    ...new Set([
      ...(list.data ? list.data.problems : []).map((p) => p.path),
      ...(chats.data ? chats.data.problems : []).map((p) => p.path),
    ]),
  ].toSorted((a, b) => a.localeCompare(b));

  if (landmarks.length === 0 && !hasUnassigned && problemPaths.length === 0) {
    return (
      <Text as="p" tone="subtle">
        No landmarks yet. Add a *.landmark.card to any directory you
        want to surface here.
      </Text>
    );
  }

  return (
    <Stack gap="md">
      {problemPaths.length > 0 ? <LandmarkProblems paths={problemPaths} /> : null}

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
function LandmarkProblems({ paths }: { paths: string[] }) {
  return (
    <Card padding="sm" border="subtle" muted>
      <Stack gap="xs">
        {paths.map((path) => (
          <Text key={path} as="div" size="sm" breakAll>
            ⚠ {path} didn&rsquo;t parse — not shown
          </Text>
        ))}
      </Stack>
    </Card>
  );
}
