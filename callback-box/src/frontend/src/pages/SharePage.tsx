/* eslint-disable personal-vibe-check/restrict-component-classes */
/**
 * SharePage — PWA share target landing page (box-scoped).
 *
 * Mounted at /:boxSlug/share. Receives shared links via URL params
 * (?url=...&title=...&text=...), lets user add an optional voice/text
 * note, and saves a bookmark card to the box's inbox.
 *
 * The root /share route (ShareRedirect in App.tsx) handles box selection
 * and redirects here with query params preserved.
 *
 * TODO: refactor to UI primitives to remove the eslint-disable above.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { useRealtimeTranscription } from "../hooks/useRealtimeTranscription";
import { ExternalLink } from "../components/ui/ExternalLink";
import { TextareaField } from "../components/ui/fields";
import { Button } from "../components/ui/Button";

type ShareState = "ready" | "saving" | "saved" | "error";

/**
 * Parse a URL from share params. Some apps put the URL in the text field.
 */
function extractUrl(params: URLSearchParams): string {
  const url = params.get("url");
  if (url) return url;

  // Some apps put the URL in the text field
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

  // Voice transcription
  const transcription = useRealtimeTranscription({
    onKeywordSend: (text) => {
      setNote((prev) => (prev ? `${prev}\n\n${text}` : text));
    },
  });

  // Append transcript to note when recording stops
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

    // If recording, stop and wait for transcript
    let extraNote = "";
    if (transcription.state === "recording") {
      const finalText = await transcription.stop();
      extraNote = finalText.trim();
    }

    setShareState("saving");
    setErrorMessage("");

    // Combine current note with any final transcription
    const fullNote = extraNote
      ? (note.trim() ? `${note.trim()}\n\n${extraNote}` : extraNote)
      : note.trim();

    try {
      // Generate card path
      const now = new Date();
      const timestamp = now.toISOString().replace(/[.:]/g, "-").slice(0, 19);
      const safeName = (sharedTitle || "Link")
        .replace(/[^\w -]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 40);
      const cardPath = `box/inbox/links/${safeName}_${timestamp}.bookmark.card`;

      // Tag note as transcription if voice was used
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

      // Parse SSE response to check for success
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
      <div className="min-h-screen bg-warm-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-xl font-bold text-warm-800 mb-4">Share to Callback</h1>
          <p className="text-warm-600">No URL was shared. Use your browser's share button to send a link here.</p>
        </div>
      </div>
    );
  }

  if (shareState === "saved") {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full text-center">
          <div className="text-3xl mb-3">&#10003;</div>
          <h1 className="text-xl font-bold text-warm-800 mb-2">Saved</h1>
          <p className="text-warm-600 text-sm mb-4 break-all">{sharedTitle || sharedUrl}</p>
          <p className="text-warm-500 text-xs">You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-warm-50 flex items-start justify-center p-4 pt-12">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-5">
        <h1 className="text-lg font-bold text-warm-900 mb-4">Save Link</h1>

        {/* Link preview */}
        <div className="mb-4 p-3 bg-warm-50 rounded border border-warm-200">
          {sharedTitle ? (
            <div className="font-medium text-warm-800 text-sm mb-1">{sharedTitle}</div>
          ) : null}
          <ExternalLink href={sharedUrl}>{sharedUrl}</ExternalLink>
        </div>

        {/* Note input */}
        <TextareaField
          label="Note (optional)"
          value={note}
          onChange={setNote}
          placeholder="Add a note about this link..."
          rows={4}
          inputClassName="resize-none text-sm"
          disabled={shareState === "saving" || transcription.state === "recording"}
          className="mb-4"
        />

        {/* Voice input */}
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={handleVoiceToggle}
            disabled={shareState === "saving" || transcription.state === "connecting" || transcription.state === "finalizing"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
              transcription.state === "recording"
                ? "bg-danger-100 text-danger-dark hover:bg-danger-100"
                : "bg-warm-100 text-warm-700 hover:bg-warm-200"
            }`}
          >
            {transcription.state === "recording" ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-light opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                </span>
                Stop
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                    clipRule="evenodd"
                  />
                </svg>
                Voice Note
              </>
            )}
          </button>

          {transcription.state === "connecting" ? (
            <span className="text-xs text-warm-500">Connecting...</span>
          ) : null}
          {transcription.state === "finalizing" ? (
            <span className="text-xs text-warm-500">Finishing...</span>
          ) : null}
        </div>

        {/* Live transcript */}
        {transcription.state === "recording" && transcription.transcript ? (
          <div className="mb-4 p-2 bg-info-50 rounded text-sm text-warm-700 italic">
            {transcription.transcript}
          </div>
        ) : null}

        {/* Transcription error */}
        {transcription.error ? (
          <div className="mb-4 text-danger-dark text-sm">Mic error: {transcription.error}</div>
        ) : null}

        {/* Error display */}
        {shareState === "error" ? (
          <div className="mb-4 text-danger-dark text-sm">Error: {errorMessage}</div>
        ) : null}

        {/* Save button */}
        <Button
          type="button"
          intent="primary"
          fullWidth
          onClick={handleSave}
          loading={shareState === "saving"}
          loadingLabel="Saving…"
        >
          Save Bookmark
        </Button>

        <p className="text-xs text-warm-500 text-center mt-3">
          Saves to inbox for processing at next wakeup.
        </p>
      </div>
    </div>
  );
}
