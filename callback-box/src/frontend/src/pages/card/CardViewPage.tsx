/**
 * Full-page scrollable viewer for a single card file. Mounted at
 * `/:boxSlug/card/<splat>`. Reads the splat param directly and hands
 * off to FileView inside a Card shell.
 */

import { useNavigate, useParams } from "@tanstack/react-router";
import { href } from "../../lib/routing";
import { useViewNavigate } from "../../hooks/useViewNavigate";
import { FileView } from "../../components/FileView";
import { Card } from "../../components/ui/Card";
import { Column } from "../../components/ui/Column";
import { Row } from "../../components/ui/Row";
import { Stack } from "../../components/ui/Stack";
import { Text } from "../../components/ui/Text";
import { TextLink } from "../../components/ui/TextLink";
import { OpenChatControl } from "./components/OpenChatControl";

export function CardViewPage() {
  const { boxSlug, _splat: cardPath } = useParams({ strict: false });
  const handleNavigate = useViewNavigate();
  const navigate = useNavigate();

  if (!cardPath) {
    return <Text as="div" tone="subtle" className="p-8">No card path specified</Text>;
  }

  return (
    <Column overflow="auto" focusable className="h-full">
      <Stack gap="md" className="max-w-4xl mx-auto py-8 px-4 w-full">
        <Row gap="md" align="center" justify="between">
          <TextLink id="cb-card-back-dashboard" to={href(`/${boxSlug}/dashboard`)} underline={false}>
            {"\u2190 Back to Dashboard"}
          </TextLink>
          {boxSlug !== undefined ? (
            <OpenChatControl boxSlug={boxSlug} cardPath={cardPath} />
          ) : null}
        </Row>
        <Card padding="none" shadow>
          <FileView path={cardPath} onNavigate={handleNavigate} onClose={() => void navigate({ to: href(`/${boxSlug}/dashboard`), replace: true })} />
        </Card>
      </Stack>
    </Column>
  );
}
