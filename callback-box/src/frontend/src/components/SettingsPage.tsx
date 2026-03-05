/**
 * Settings page with dropbox pairing UI and calendar configuration.
 */

import { useState, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { trpc, type RouterOutput } from "../lib/trpc";

type AvailableCalendar = RouterOutput["calendar"]["available"][number];

function CalendarSection() {
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
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
          {error}
        </div>
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
          <label
            key={cal.id}
            className="flex items-center gap-3 px-3 py-2 rounded hover:bg-warm-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={cal.syncing}
              onChange={() => toggleCalendar(cal)}
              disabled={updateMutation.isPending}
              className="rounded border-warm-400 text-plum focus:ring-gold"
            />
            <span className="flex-1 min-w-0">
              <span className="text-sm text-warm-900">{cal.summary}</span>
              {cal.primary ? (
                <span className="ml-1 text-xs text-warm-500">(primary)</span>
              ) : null}
              {cal.accessRole !== "owner" && (
                <span className="ml-1 text-xs text-warm-500">
                  ({cal.accessRole})
                </span>
              )}
            </span>
            {cal.backgroundColor ? (
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: cal.backgroundColor }}
              />
            ) : null}
          </label>
        ))}
      </div>
    </div>
  );
}

function ShortcutUrlDisplay({ url }: { url: string }) {
  return (
    <code className="block mt-1 mb-1 p-2 bg-white border border-warm-300 rounded text-xs break-all select-all">
      {url}?url=<span className="text-plum">{"[Shortcut Input]"}</span>
    </code>
  );
}

function ShortcutSteps({ boxSlug, shareUrl }: { boxSlug: string; shareUrl: string }) {
  return (
    <div className="text-xs text-warm-700 space-y-1.5">
      <p>1. Open the <strong>Shortcuts</strong> app on your iPhone/iPad</p>
      <p>2. Tap <strong>+</strong> to create a new shortcut</p>
      <p>3. Name it <strong>Save to {boxSlug}</strong></p>
      <p>4. Tap <strong>Add Action</strong>, search for <strong>Open URLs</strong></p>
      <p>5. Set the URL to:</p>
      <ShortcutUrlDisplay url={shareUrl} />
      <p>
        Tap the <span className="text-plum">Shortcut Input</span> part —
        select <strong>Shortcut Input</strong> from the variables list (it
        provides the shared URL).
      </p>
      <p>
        6. Tap the <strong>ⓘ</strong> at the bottom → enable{" "}
        <strong>Show in Share Sheet</strong>
      </p>
      <p>
        7. Under <strong>Share Sheet Types</strong>, select only{" "}
        <strong>URLs</strong>
      </p>
    </div>
  );
}

function ShareShortcutSection() {
  const { boxSlug } = useParams();
  const origin = window.location.origin;
  const boxShareUrl = `${origin}/${boxSlug}/share`;
  const generalShareUrl = `${origin}/share`;

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">
        iOS Share Shortcut
      </h2>
      <p className="text-sm text-warm-700 mb-4">
        iOS doesn't support web app share targets, but you can create an iOS
        Shortcut that appears in the share sheet. Choose one of these two
        options:
      </p>

      <div className="space-y-4">
        <BoxSpecificOption boxSlug={boxSlug || ""} shareUrl={boxShareUrl} />
        <GeneralOption shareUrl={generalShareUrl} />
      </div>

      <p className="text-xs text-warm-500 mt-4">
        After creating the shortcut, share any link from Safari or other apps
        and choose your shortcut from the share sheet.
      </p>
    </div>
  );
}

function BoxSpecificOption({ boxSlug, shareUrl }: { boxSlug: string; shareUrl: string }) {
  return (
    <div className="p-4 bg-warm-50 rounded border border-warm-200">
      <h3 className="text-sm font-semibold text-warm-800 mb-2">
        Option A: Share to this box directly
      </h3>
      <p className="text-xs text-warm-600 mb-2">
        Links go straight to <strong>{boxSlug}</strong> with no box
        selection step.
      </p>
      <ShortcutSteps boxSlug={boxSlug} shareUrl={shareUrl} />
    </div>
  );
}

function GeneralOption({ shareUrl }: { shareUrl: string }) {
  return (
    <div className="p-4 bg-warm-50 rounded border border-warm-200">
      <h3 className="text-sm font-semibold text-warm-800 mb-2">
        Option B: Share with box selection
      </h3>
      <p className="text-xs text-warm-600 mb-2">
        Shows a box picker first (useful if you have multiple boxes).
      </p>
      <div className="text-xs text-warm-700 space-y-1.5">
        <p>Follow the same steps as Option A, but set the URL to:</p>
        <ShortcutUrlDisplay url={shareUrl} />
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { boxSlug } = useParams();
  const statusQuery = trpc.pairing.status.useQuery();
  const pairMutation = trpc.pairing.pair.useMutation();
  const utils = trpc.useUtils();
  const [workerUrlOverride, setWorkerUrlOverride] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const status = statusQuery.data;
  const loading = statusQuery.isLoading;
  const error = statusQuery.error?.message ?? pairMutation.error?.message ?? null;

  // Use local override if user has edited, otherwise fall back to server value
  const serverUrl = status && "workerUrl" in status ? (status.workerUrl ?? "") : "";
  const workerUrl = workerUrlOverride ?? serverUrl;
  const setWorkerUrl = (v: string) => setWorkerUrlOverride(v);

  // Clean up countdown timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handlePair = async () => {
    if (!workerUrl.trim()) return;

    try {
      const result = await pairMutation.mutateAsync({ workerUrl: workerUrl.trim() });

      // Start countdown
      const expiresMs = new Date(result.expiresAt).getTime() - Date.now();
      setCountdown(Math.max(0, Math.round(expiresMs / 1000)));

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Refresh status
      utils.pairing.status.invalidate();
    } catch {
      // error handled by mutation state
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-warm-600">
        Loading...
      </div>
    );
  }

  const pairResult = pairMutation.data;

  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6">
          <Link to={`/${boxSlug}/`} className="text-plum hover:text-plum-dark text-sm">
            &larr; Back to Dashboard
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-warm-900 mb-6">Settings</h1>

        {/* Dropbox Pairing Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-warm-800 mb-4">
            Browser Message Relay
          </h2>
          <p className="text-sm text-warm-700 mb-4">
            Connect a browser extension to send memos and context to your callback box
            via an encrypted relay.
          </p>

          {/* Current status */}
          {status && "paired" in status && status.paired ? (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm">
              <span className="font-medium text-green-800">Connected</span>
              <span className="text-green-700 ml-2">to {status.workerUrl}</span>
            </div>
          ) : (
            <div className="mb-4 p-3 bg-warm-50 border border-warm-300 rounded text-sm text-warm-700">
              Not connected
            </div>
          )}

          {/* Worker URL input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Worker URL
            </label>
            <input
              type="url"
              value={workerUrl}
              onChange={(e) => setWorkerUrl(e.target.value)}
              placeholder="https://callback-dropbox.your-account.workers.dev"
              className="w-full border border-warm-400 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </div>

          {/* Pair button */}
          <button
            onClick={handlePair}
            disabled={pairMutation.isPending || !workerUrl.trim()}
            className="btn btn-primary"
          >
            {pairMutation.isPending
              ? "Creating..."
              : status && "paired" in status && status.paired
                ? "Generate New Pairing Code"
                : "Generate Pairing Code"}
          </button>

          {/* Error */}
          {error ? (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {/* Pairing code display */}
          {pairResult ? (
            <div className="mt-6 p-4 bg-iris-50 border border-iris-100 rounded">
              <p className="text-sm text-plum mb-2">
                Enter this code in your browser extension:
              </p>
              <div className="text-3xl font-mono font-bold text-iris-dark tracking-widest text-center py-2">
                {pairResult.code}
              </div>
              {countdown !== null && countdown > 0 ? (
                <p className="text-xs text-plum text-center mt-2">
                  Expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
                </p>
              ) : countdown === 0 ? (
                <p className="text-xs text-red-600 text-center mt-2">
                  Expired — generate a new code
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <CalendarSection />

        <ShareShortcutSection />
      </div>
    </div>
  );
}
