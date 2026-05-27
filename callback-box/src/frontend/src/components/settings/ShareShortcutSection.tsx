/**
 * iOS Share Shortcut section — step-by-step instructions for creating a
 * Shortcut that forwards a URL into the box. Two option cards: box-scoped
 * or with a box picker step.
 */

import { useParams } from "@tanstack/react-router";
import { withBase } from "../../api";

function ShortcutUrlDisplay({ url }: { url: string }) {
  return (
    <code className="block mt-1 mb-1 p-2 bg-white border border-warm-300 rounded text-xs break-all select-all">
      {url}?url=<span className="text-primary">{"[Shortcut Input]"}</span>
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
        Tap the <span className="text-primary">Shortcut Input</span> part —
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

export function ShareShortcutSection() {
  const { boxSlug } = useParams({ strict: false });
  const origin = window.location.origin;
  const boxShareUrl = `${origin}${withBase(`/${boxSlug}/share`)}`;
  const generalShareUrl = `${origin}${withBase("/share")}`;

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <h2 className="text-lg font-semibold text-warm-800 mb-2">
        iOS Share Shortcut
      </h2>
      <p className="text-sm text-warm-700 mb-4">
        iOS doesn&apos;t support web app share targets, but you can create an iOS
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
