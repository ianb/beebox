import type { ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import { SYSTEM_CARD_PATHS, systemCardLocationError, type SystemCardType } from "@shared/system-card-paths";
import { href } from "../../lib/routing";
import { Card } from "../ui/Card";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { TextLink } from "../ui/TextLink";

/** Identity guard only; the instrument's existing server authorization still applies. */
export function SystemCardBoundary({ path, type, children }: { path: string; type: SystemCardType; children: ReactNode }) {
  const { boxSlug } = useParams({ strict: false });
  const error = systemCardLocationError(type, path);
  if (!error) return children;
  return <Card padding="md" border="subtle"><Stack gap="sm">
    <Text as="p" tone="danger">{error}</Text>
    <TextLink to={href(`/${boxSlug}/views/${SYSTEM_CARD_PATHS[type]}`)}>Open canonical {type}</TextLink>
  </Stack></Card>;
}
