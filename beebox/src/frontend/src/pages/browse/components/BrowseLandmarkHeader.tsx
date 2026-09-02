import type { RouterOutput } from "../../../lib/trpc";
import type { ViewTarget } from "../../../lib/view-url";
import {
  LandmarkGroup,
  LandmarkLinks,
  LandmarkSymbol,
} from "../../../components/landmarks/LandmarkSection";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";

type Landmark = NonNullable<RouterOutput["landmarks"]["forDir"]["landmark"]>;

export function BrowseLandmarkHeader({
  landmark,
  boxSlug,
  onNavigate,
}: {
  landmark: Landmark;
  boxSlug: string;
  onNavigate: (target: ViewTarget) => void;
}) {
  return (
    <section aria-label={`${landmark.label || landmark.path} landmark`} className="border-b border-warm-200 p-4">
      <Stack gap="sm">
        <div className="flex items-center gap-2">
          <LandmarkSymbol landmark={landmark} boxSlug={boxSlug} compact />
          <Text as="h2" size="sm" weight="bold">
            <button
              type="button"
              onClick={() => onNavigate({ path: landmark.path, viewer: null, params: {}, viewState: null })}
              aria-label={`Open ${landmark.label || landmark.path} landmark details`}
              className="text-left hover:underline"
            >
              {landmark.label || landmark.path}
            </button>
          </Text>
        </div>
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
    </section>
  );
}
