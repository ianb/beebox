/**
 * Dashboard page — single scrollable overview of the box.
 */

import { useBusSubscription } from "../hooks/useBusSubscription";
import { useState } from "react";
import { errorMessage } from "@shared/error-guards";
import { trpc, trpcClient } from "../lib/trpc";
import { describeBrowserTaskState } from "@shared/browser-task-state";
import { HeaderStrip } from "../components/dashboard/HeaderStrip";
import { AttentionCards } from "../components/dashboard/AttentionCards";
import { ScheduleOverview } from "../components/dashboard/ScheduleOverview";
import { RecentActivity } from "../components/dashboard/RecentActivity";
import { SystemInfo } from "../components/dashboard/SystemInfo";
import { HealthWarnings, type HealthActionPending } from "../components/dashboard/HealthWarnings";
import { OpsLinks } from "../components/dashboard/OpsLinks";
import { Stack } from "../components/ui/Stack";
import { useCurrentUser } from "../hooks/useCurrentUser";

export function DashboardPage() {
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissingCheck, setDismissingCheck] = useState<string | null>(null);
  const statusQuery = trpc.status.status.useQuery();
  const healthQuery = trpc.health.check.useQuery();
  const acknowledgeBoxGrowth = trpc.health.acknowledgeBoxGrowth.useMutation();
  const expectBoxGrowthRates = trpc.health.expectBoxGrowthRates.useMutation();
  const dismissConnectorEpisode = trpc.health.dismissConnectorEpisode.useMutation();
  const schedulesQuery = trpc.scheduler.schedules.useQuery();
  const ticksQuery = trpc.scheduler.log.useQuery({ limit: 20, event: "tick" });
  const commitsQuery = trpc.status.activity.useQuery({ count: 15 });
  const questionsQuery = trpc.status.questions.useQuery();
  const browserTasksQuery = trpc.browserTask.list.useQuery();

  const invalidateAll = () => {
    void utils.status.invalidate();
    void utils.scheduler.invalidate();
  };

  const { connected } = useBusSubscription({
    onEvent: (event) => {
      if (
        event.event === "file-change" ||
        event.event === "question-answered" ||
        event.event === "card-created" ||
        event.event === "wakeup-complete"
      ) {
        invalidateAll();
      }
    },
  });

  const status = statusQuery.data ?? null;
  const schedules = schedulesQuery.data?.schedules ?? [];
  const ticks = ticksQuery.data?.entries ?? [];
  const commits = commitsQuery.data?.entries ?? [];
  const questions = questionsQuery.data?.items ?? [];
  const dueBrowserTasks = (browserTasksQuery.data?.items ?? [])
    .filter((t) => t.state.kind === "due" || t.state.kind === "never-scanned")
    .map((t) => ({ path: t.path, title: t.title, stateLabel: describeBrowserTaskState(t.state) }));

  const schedulesLoading = schedulesQuery.isLoading || ticksQuery.isLoading;
  const schedulesError = schedulesQuery.error || ticksQuery.error;
  const activityLoading = commitsQuery.isLoading || ticksQuery.isLoading;
  const activityError = commitsQuery.error || ticksQuery.error;

  async function refreshHealth(): Promise<void> {
    const health = await trpcClient.health.check.query({ fresh: true });
    utils.health.check.setData(undefined, health);
  }

  /** Run an owner decision, then force a live health read into the dashboard cache. */
  async function decide(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await action();
      // Do not invalidate into an older in-flight snapshot. Force a live read,
      // then put that exact result into the normal dashboard query cache.
      await refreshHealth();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  const acknowledgeCurrentGrowth = () => decide(() => acknowledgeBoxGrowth.mutateAsync());
  const expectCurrentGrowthRates = () => decide(() => expectBoxGrowthRates.mutateAsync());
  async function dismissEpisode(check: string): Promise<void> {
    setDismissingCheck(check);
    try {
      await decide(() => dismissConnectorEpisode.mutateAsync({ check }));
    } finally {
      setDismissingCheck(null);
    }
  }
  const actionPending: HealthActionPending = acknowledgeBoxGrowth.isPending
    ? { kind: "acknowledge" }
    : expectBoxGrowthRates.isPending
      ? { kind: "expect-rates" }
      : dismissingCheck !== null ? { kind: "dismiss", check: dismissingCheck } : null;

  return (
    <Stack gap="none" overflow="hidden" className="h-full">
      <HeaderStrip
        status={status}
        connected={connected}
      />

      <Stack gap="none" overflow="auto" focusable className="flex-1">
        <Stack gap="lg" className="w-full min-w-0 max-w-4xl mx-auto py-4 px-4">
          <OpsLinks />

          <HealthWarnings
            health={healthQuery.data ?? null}
            canManage={currentUser?.isOwner === true}
            actionPending={actionPending}
            actionError={actionError}
            onAcknowledgeBoxGrowth={acknowledgeCurrentGrowth}
            onExpectBoxGrowthRates={expectCurrentGrowthRates}
            onDismissConnectorEpisode={dismissEpisode}
          />

          <AttentionCards
            questions={questions}
            inboxCount={status?.counts.inbox ?? 0}
            dueBrowserTasks={dueBrowserTasks}
          />

          <ScheduleOverview
            schedules={schedules}
            recentTicks={ticks}
            loading={schedulesLoading}
            error={schedulesError}
          />

          <RecentActivity
            commits={commits}
            ticks={ticks}
            loading={activityLoading}
            error={activityError}
          />
        </Stack>
      </Stack>

      <SystemInfo status={status} version={healthQuery.data?.version ?? null} />
    </Stack>
  );
}
