/**
 * One landmark rendered as a section: symbol + label header, plus a
 * grid of resolved link tiles. Click a tile to open the target card.
 */

import { Link } from "@tanstack/react-router";
import { href } from "../../../lib/routing";
import { Card } from "../../../components/ui/Card";
import { Stack } from "../../../components/ui/Stack";
import { Text } from "../../../components/ui/Text";

interface ResolvedLink {
  ref: string;
  label: string | null;
  title: string;
  exists: boolean;
}

interface Landmark {
  path: string;
  dir: string;
  label: string;
  symbol: string;
  links: ResolvedLink[];
}

export function LandmarkSection({ landmark, boxSlug }: { landmark: Landmark; boxSlug: string }) {
  const labelText = landmark.label || landmark.path;

  return (
    <Card padding="md" border="subtle" shadow>
      <Stack gap="md">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl leading-none" aria-hidden>
            {landmark.symbol || "📍"}
          </span>
          <Stack gap="xs">
            <Text as="h2" size="lg" weight="bold">{labelText}</Text>
            {landmark.dir ? (
              <Link
                to={href(`/${boxSlug}/browse/${landmark.dir}`)}
                className="hover:underline"
              >
                <Text as="span" size="xs" tone="muted">{landmark.dir}/</Text>
              </Link>
            ) : null}
          </Stack>
        </div>

        {landmark.links.length === 0 ? (
          <Text as="p" size="sm" tone="muted">No linked items.</Text>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {landmark.links.map((link) => (
              <LinkTile key={link.ref} link={link} boxSlug={boxSlug} />
            ))}
          </div>
        )}
      </Stack>
    </Card>
  );
}

function LinkTile({ link, boxSlug }: { link: ResolvedLink; boxSlug: string }) {
  const display = link.label !== null && link.label.length > 0 ? link.label : link.title;

  if (!link.exists) {
    return (
      <Card padding="sm" border="subtle" muted>
        <Text as="div" size="sm" weight="medium" tone="muted">{display}</Text>
        <Text as="div" size="xs" tone="muted">Missing</Text>
      </Card>
    );
  }

  return (
    <Link to={href(`/${boxSlug}/card/${link.ref}`)} className="block">
      <Card padding="sm" border="subtle" className="hover:border-info-400 transition-colors">
        <Text as="div" size="sm" weight="medium">{display}</Text>
        <Text as="div" size="xs" tone="muted" truncate>{link.ref}</Text>
      </Card>
    </Link>
  );
}
