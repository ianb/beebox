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

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import { ExternalLink } from "../components/ui/ExternalLink";
import { TextareaField } from "../components/ui/fields";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Column } from "../components/ui/Column";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Text } from "../components/ui/Text";
import { VoiceNoteButton } from "../components/VoiceNoteButton";

type ShareState = "ready" | "saving" | "saved" | "error";

/**
 * Parse a URL from share params. Some apps put the URL in the text field.
 */
function extractUrl(params: URLSearchParams): string {
  const url = params.get("url");
  if (url) return url;

  const text = params.get("text") || "";
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch) return urlMatch[0];

  return "";
}

/**
 * Extract non-URL text from the text param (some apps combine note + URL).
 */
function extractText(params: URLSearchParams): string {
  const text = params.get("text") || "";
  return text.replace(/https?:\/\/\S+/g, "").trim();
}

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

  const [note, setNote] = useState(sharedText);
  const [usedVoice, setUsedVoice] = useState(false);
  const [shareState, setShareState] = useState<ShareState>("ready");
  const [errorMessage, setErrorMessage] = useState("");

  const transcription = useRealtimeTranscription({
    onKeywordSend: (text) => {
      setNote((prev) => (prev ? `${prev}\n\n${text}` : text));
    },
  });

  const prevTranscriptRef = useRef("");
  useEffect(() => {
    if (
      transcription.state === "idle" &&
      transcription.transcript &&
      transcription.transcript !== prevTranscriptRef.current
    ) {
      const text = transcription.transcript.trim();
      if (text) {
        setNote((prev) => (prev ? `${prev}\n\n${text}` : text));
      }
      prevTranscriptRef.current = transcription.transcript;
    }
  }, [transcription.state, transcription.transcript]);

  const handleSave = useCallback(async () => {
    if (!sharedUrl || !boxSlug) return;

    let extraNote = "";
    if (transcription.state === "recording") {
      const finalText = await transcription.stop();
      extraNote = finalText.trim();
    }

    setShareState("saving");
    setErrorMessage("");

    const fullNote = extraNote
      ? (note.trim() ? `${note.trim()}\n\n${extraNote}` : extraNote)
      : note.trim();

    try {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[.:]/g, "-").slice(0, 19);
      const safeName = (sharedTitle || "Link")
        .replace(/[^\w -]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 40);
      const cardPath = `box/inbox/links/${safeName}_${timestamp}.bookmark.card`;

      let noteText = fullNote;
      if (noteText && usedVoice) {
        noteText = `[Audio Input Transcription]\n${noteText}`;
      }

      const args: Record<string, unknown> = {
        path: cardPath,
        commit: true,
        args: {
          title: sharedTitle || sharedUrl,
          link: sharedUrl,
          ...(noteText ? { note: noteText } : {}),
        },
      };

      const response = await fetch(`/${boxSlug}/api/commands/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "create", args }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || "Save failed");
      }

      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let success = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "result" && data.success) {
                  success = true;
                }
              } catch {
                // skip
              }
            }
          }
        }
        if (!success) {
          throw new Error("Command did not report success");
        }
      }

      setShareState("saved");
    } catch (err) {
      setShareState("error");
      setErrorMessage((err as Error).message);
    }
  }, [sharedUrl, sharedTitle, boxSlug, note, usedVoice, transcription]);

  const handleVoiceToggle = useCallback(() => {
    if (transcription.state === "recording") {
      transcription.stop();
    } else if (transcription.state === "idle") {
      prevTranscriptRef.current = "";
      setUsedVoice(true);
      transcription.start();
    }
  }, [transcription]);

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
