import { useParams } from "@tanstack/react-router";
import { WHATS_NEW_PATH } from "@shared/whats-new-path";
import { href } from "../../lib/routing";
import { Card } from "../ui/Card";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Stack } from "../ui/Stack";
import { TextLink } from "../ui/TextLink";

/** Settings' entrance to the person's changelog, which the engine copies into the box. */
export function WhatsNewSection() {
  const { boxSlug } = useParams({ strict: false });
  return (
    <Card as="section" aria-label="Bee Box" shadow material>
      <Stack gap="xs">
        <Heading level={2}>Bee Box</Heading>
        <TextLink id="bbx-settings-whats-new" to={href(`/${boxSlug ?? ""}/views/${WHATS_NEW_PATH}`)}>What&apos;s new in Bee Box</TextLink>
        <Hint>Changes you can see or use, newest first.</Hint>
      </Stack>
    </Card>
  );
}
