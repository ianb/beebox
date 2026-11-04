/**
 * Google Calendar section: list of available calendars, each with a
 * sync toggle. Updates the box's calendar config via tRPC.
 */

import { useEffect, useState } from "react";
import { trpc, type RouterOutput } from "../../lib/trpc/client";
import { CheckboxField, NumberField } from "../ui/fields/field";
import { Row } from "../ui/Row";
import { Card } from "../ui/Card";
import { Heading } from "../ui/Heading";
import { Text } from "../ui/Text";
import { Notice } from "../ui/Notice";
import { GoogleConnectLink } from "./GoogleConnectLink";

type AvailableCalendar = RouterOutput["calendar"]["available"][number];

const DEFAULT_DAYS_BACK = 30;
const DEFAULT_DAYS_FORWARD = 90;

export function CalendarSection() {
  const calendarsQuery = trpc.calendar.available.useQuery();
  const configQuery = trpc.calendar.config.useQuery();
  const updateMutation = trpc.calendar.updateConfig.useMutation();
  const utils = trpc.useUtils();

  const calendars = calendarsQuery.data;
  const config = configQuery.data;
  const error = calendarsQuery.error?.message ?? configQuery.error?.message ?? null;

  const [daysBack, setDaysBack] = useState<number | null>(null);
  const [daysForward, setDaysForward] = useState<number | null>(null);

  // Prefill the sync-window inputs once the config loads.
  useEffect(() => {
    if (!config) return;
    setDaysBack(config.syncDaysBack ?? DEFAULT_DAYS_BACK);
    setDaysForward(config.syncDaysForward ?? DEFAULT_DAYS_FORWARD);
  }, [config]);

  const saveSyncWindow = async (next: { syncDaysBack?: number; syncDaysForward?: number }) => {
    if (!config) return;
    try {
      await updateMutation.mutateAsync({ ...config, ...next });
      void utils.calendar.invalidate();
    } catch (_e) {
      // error surfaced to the user via the mutation's error state
    }
  };

  const toggleCalendar = async (cal: AvailableCalendar) => {
    if (!config) return;

    const currentList = config.calendars || ["primary"];
    const calId = cal.primary && cal.resolvedId ? cal.resolvedId : cal.id;
    const isCurrentlySyncing = cal.syncing;

    let newList: string[];
    if (isCurrentlySyncing) {
      newList = currentList.filter((id) => {
        if (id === calId) return false;
        if (cal.primary && id === "primary") return false;
        return true;
      });
    } else {
      newList = [...currentList, calId];
    }

    try {
      await updateMutation.mutateAsync({ ...config, calendars: newList });
      void utils.calendar.invalidate();
    } catch (_e) {
      // error surfaced to the user via the mutation's error state
    }
  };

  if (error) {
    return (
      <Card material padding="lg" border="none" shadow>
        <Heading level={2} className="mb-4">Google Calendar</Heading>
        <Notice tone="warning">{error}</Notice>
        <GoogleConnectLink id="bbx-settings-calendar-connect-google" service="Calendar" />
      </Card>
    );
  }

  if (!calendars) {
    return (
      <Card material padding="lg" border="none" shadow>
        <Heading level={2} className="mb-4">Google Calendar</Heading>
        <Text as="p" size="sm" tone="muted">Loading calendars...</Text>
      </Card>
    );
  }

  return (
    <Card material padding="lg" border="none" shadow>
      <Heading level={2} className="mb-2">Google Calendar</Heading>
      <Text as="p" size="sm" tone="emphasis" className="mb-4">
        Choose which calendars to sync. Events are pulled as .ics files during{" "}
        <code className="text-xs bg-warm-100 text-warm-900 px-1 rounded">bbx wakeup</code>.
      </Text>

      <div className="space-y-1">
        {calendars.map((cal) => (
          <div key={cal.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-card-tint">
            <CheckboxField
              label={
                <>
                  {cal.summary}
                  {cal.primary ? (
                    <Text size="xs" tone="muted" className="ml-1">(primary)</Text>
                  ) : null}
                  {cal.accessRole !== "owner" ? (
                    <Text size="xs" tone="muted" className="ml-1">({cal.accessRole})</Text>
                  ) : null}
                </>
              }
              checked={cal.syncing}
              onChange={() => void toggleCalendar(cal)}
              disabled={updateMutation.isPending}
              className="flex-1 min-w-0"
            />
            {cal.backgroundColor ? (
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: cal.backgroundColor }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>

      <Heading level={3} className="mt-6 mb-1">Sync window</Heading>
      <Text as="p" size="sm" tone="emphasis" className="mb-3">
        How many days of events to pull, relative to today.
      </Text>
      <Row gap="md">
        <NumberField
          label="Days back"
          value={daysBack}
          onChange={setDaysBack}
          onBlur={() => { if (daysBack !== null) void saveSyncWindow({ syncDaysBack: daysBack }); }}
          min={0}
          disabled={updateMutation.isPending}
          className="w-32"
        />
        <NumberField
          label="Days forward"
          value={daysForward}
          onChange={setDaysForward}
          onBlur={() => { if (daysForward !== null) void saveSyncWindow({ syncDaysForward: daysForward }); }}
          min={0}
          disabled={updateMutation.isPending}
          className="w-32"
        />
      </Row>
    </Card>
  );
}
