/**
 * SharePage — PWA share target landing page (box-scoped).
 *
 * Mounted at /:boxSlug/share. Receives shared links via URL params
 * (?url=...&title=...&text=...), lets user add an optional voice/text
 * note, and saves a bookmark card to the box's inbox.
 *
 * The root /share route (ShareRedirect in App.tsx) handles box selection
 * and redirects here with query params preserved.
 */

import { useParams } from "@tanstack/react-router";
import { ExternalLink } from "../components/ui/ExternalLink";
import { TextareaField } from "../components/ui/fields";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Column } from "../components/ui/Column";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { VoiceNoteButton } from "../components/VoiceNoteButton";
import { extractText, extractUrl } from "./share-params";
import { useShareNote } from "./useShareNote";

function CenteredPanel({ children }: { children: React.ReactNode }) {
  return (
    <Row justify="center" align="center" className="min-h-screen p-4">
      <Column className="max-w-sm w-full" align="center">
        {children}
      </Column>
    </Row>
  );
}

export function SharePage() {
  const { boxSlug } = useParams({ strict: false });
  const params = new URLSearchParams(window.location.search);
  const sharedUrl = extractUrl(params);
  const sharedTitle = params.get("title") || "";
  const sharedText = extractText(params);

  const {
    note,
    setNote,
    shareState,
    errorMessage,
    transcription,
    handleSave,
    handleVoiceToggle,
  } = useShareNote({ boxSlug, sharedUrl, sharedTitle, sharedText });

  if (!sharedUrl) {
    return (
      <CenteredPanel>
        <Text as="h1" size="xl" weight="bold" tone="emphasis" center className="mb-4">
          Share to Callback
        </Text>
        <Text as="p" tone="subtle" center>
          No URL was shared. Use your browser&apos;s share button to send a link here.
        </Text>
      </CenteredPanel>
    );
  }

  if (shareState === "saved") {
    return (
      <CenteredPanel>
        <Text size="2xl" className="mb-3">&#10003;</Text>
        <Text as="h1" size="xl" weight="bold" tone="emphasis" center className="mb-2">Saved</Text>
        <Text as="p" tone="subtle" size="sm" center breakAll className="mb-4">{sharedTitle || sharedUrl}</Text>
        <Text as="p" tone="muted" size="xs" center>You can close this page.</Text>
      </CenteredPanel>
    );
  }

  return (
    <Row justify="center" align="start" className="min-h-screen p-4 pt-12">
      <Card shadow className="max-w-md w-full" padding="lg" border="none">
        <Stack gap="md">
          <Text as="h1" size="lg" weight="bold">Save Link</Text>

          <Card padding="sm" background="warm" border="subtle">
            {sharedTitle ? (
              <Text as="div" size="sm" weight="medium" tone="emphasis" className="mb-1">{sharedTitle}</Text>
            ) : null}
            <ExternalLink href={sharedUrl}>{sharedUrl}</ExternalLink>
          </Card>

          <TextareaField
            label="Note (optional)"
            value={note}
            onChange={setNote}
            placeholder="Add a note about this link..."
            rows={4}
            inputClassName="resize-none text-sm"
            disabled={shareState === "saving" || transcription.state === "recording"}
          />

          <Row gap="sm" align="center">
            <VoiceNoteButton
              state={transcription.state}
              onToggle={handleVoiceToggle}
              disabled={shareState === "saving"}
            />
            {transcription.state === "connecting" ? (
              <Text size="xs" tone="muted">Connecting...</Text>
            ) : null}
            {transcription.state === "reconnecting" ? (
              <Text size="xs" tone="muted">Reconnecting...</Text>
            ) : null}
            {transcription.state === "finalizing" ? (
              <Text size="xs" tone="muted">Finishing...</Text>
            ) : null}
          </Row>

          {transcription.state === "recording" && transcription.transcript ? (
            <Card padding="sm" background="info" border="none" rounding="default">
              <Text size="sm" tone="emphasis" italic>{transcription.transcript}</Text>
            </Card>
          ) : null}

          {transcription.error ? (
            <Text as="div" tone="danger" size="sm">Mic error: {transcription.error}</Text>
          ) : null}

          {shareState === "error" ? (
            <Text as="div" tone="danger" size="sm">Error: {errorMessage}</Text>
          ) : null}

          <Button
            intent="primary"
            fullWidth
            onClick={handleSave}
            loading={shareState === "saving"}
            loadingLabel="Saving…"
          >
            Save Bookmark
          </Button>

          <Text as="p" size="xs" tone="muted" center>
            Saves to inbox for processing at next wakeup.
          </Text>
        </Stack>
      </Card>
    </Row>
  );
}
