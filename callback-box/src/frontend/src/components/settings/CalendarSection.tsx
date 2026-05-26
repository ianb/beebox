/**
 * Google Calendar section: list of available calendars, each with a
 * sync toggle. Updates the box's calendar config via tRPC.
 */

import { trpc, type RouterOutput } from "../../lib/trpc";
import { CheckboxField } from "../ui/fields";
import { GoogleConnectLink } from "./GoogleConnectLink";

type AvailableCalendar = RouterOutput["calendar"]["available"][number];

export function CalendarSection() {
  const calendarsQuery = trpc.calendar.available.useQuery();
  const configQuery = trpc.calendar.config.useQuery();
  const updateMutation = trpc.calendar.updateConfig.useMutation();
  const utils = trpc.useUtils();

  const calendars = calendarsQuery.data;
  const config = configQuery.data;
  const error = calendarsQuery.error?.message ?? configQuery.error?.message ?? null;

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
      utils.calendar.invalidate();
    } catch {
      // error handled by mutation state
    }
  };

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">
          Google Calendar
        </h2>
        <div className="p-3 bg-warning-50 border border-warning-100 rounded text-sm text-warning-dark">
          {error}
        </div>
        <GoogleConnectLink />
      </div>
    );
  }

  if (!calendars) {
    return (
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-lg font-semibold text-warm-800 mb-4">
          Google Calendar
        </h2>
        <p className="text-sm text-warm-600">Loading calendars...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">
        Google Calendar
      </h2>
      <p className="text-sm text-warm-700 mb-4">
        Choose which calendars to sync. Events are pulled as .ics files during{" "}
        <code className="text-xs bg-warm-100 px-1 rounded">cb wakeup</code>.
      </p>

      <div className="space-y-1">
        {calendars.map((cal) => (
          <div key={cal.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-warm-50">
            <CheckboxField
              label={
                <>
                  {cal.summary}
                  {cal.primary ? (
                    <span className="ml-1 text-xs text-warm-500">(primary)</span>
                  ) : null}
                  {cal.accessRole !== "owner" ? (
                    <span className="ml-1 text-xs text-warm-500">({cal.accessRole})</span>
                  ) : null}
                </>
              }
              checked={cal.syncing}
              onChange={() => toggleCalendar(cal)}
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
    </div>
  );
}
