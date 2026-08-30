import type { RouterOutput } from "../../lib/trpc";
import type { NavigateHint, ViewTarget } from "../../lib/view-url";
import { LandmarkGroup, LandmarkLinks, LandmarkSymbol } from "./LandmarkSection";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";

type Landmark = NonNullable<RouterOutput["landmarks"]["forDir"]["landmark"]>;

/** Compact orientation and curated navigation for a landmarked directory. */
export function LandmarkContextHeader({
  landmark,
  boxSlug,
  onNavigate,
  collapseNavigationOnMobile,
}: {
  landmark: Landmark;
  boxSlug: string;
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /** Keep short mobile companion panes oriented without crowding out the document. */
  collapseNavigationOnMobile?: boolean;
}) {
  const collapseMobile = collapseNavigationOnMobile === true;
  return (
    <section aria-label={`${landmark.label || landmark.path} landmark`} className="border-b border-warm-200 p-4">
      <Stack gap="sm">
        <div className="flex items-center gap-2">
          <LandmarkSymbol landmark={landmark} boxSlug={boxSlug} compact />
          <Text as="h2" size="sm" weight="bold">
            <button
              type="button"
              onClick={() => onNavigate({ path: landmark.path, viewer: null, params: {} })}
              aria-label={`Open ${landmark.label || landmark.path} landmark details`}
              className="text-left hover:underline"
            >
              {landmark.label || landmark.path}
            </button>
          </Text>
        </div>
        <Stack gap="sm" className={collapseMobile ? "hidden md:block" : undefined}>
          <LandmarkLinks links={landmark.links} boxSlug={boxSlug} onNavigate={onNavigate} compact />
          {landmark.groups.map((group) => (
            <LandmarkGroup
              key={group.label}
              group={group}
              boxSlug={boxSlug}
              onNavigate={onNavigate}
              compact
            />
          ))}
        </Stack>
      </Stack>
    </section>
  );
}
