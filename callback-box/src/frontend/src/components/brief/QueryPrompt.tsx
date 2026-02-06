/**
 * QueryPrompt - Prompts for user input (text or voice response).
 */

import { useState } from "react";
import { MicrophoneIcon } from "../VoiceRecorder";
import type { Query } from "./types";
import { InlineVoiceRecorder } from "./InlineVoiceRecorder";

export function QueryPrompt({
  query,
  onResponse,
  onVoiceResponse,
}: {
  query: Query;
  onResponse?: (id: string, response: string) => void;
  onVoiceResponse?: (id: string, audioBlob: Blob) => Promise<void>;
}) {
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showVoice, setShowVoice] = useState(false);

  const handleSubmit = () => {
    if (response.trim() && onResponse && query.id) {
      onResponse(query.id, response);
      setSubmitted(true);
    }
  };

  const handleVoiceComplete = async (blob: Blob) => {
    if (onVoiceResponse && query.id) {
      await onVoiceResponse(query.id, blob);
      setShowVoice(false);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="my-4 p-4 bg-green-50 border border-green-200 rounded-lg">
        <p className="text-green-800 text-sm">Got it, I'll keep that in mind.</p>
      </div>
    );
  }

  return (
    <div className="my-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="font-medium text-amber-900 mb-2">{query.prompt}</p>
      {query.text && <p className="text-sm text-amber-700 mb-3">{query.text}</p>}
      {showVoice ? (
        <InlineVoiceRecorder
          onComplete={handleVoiceComplete}
          onCancel={() => setShowVoice(false)}
        />
      ) : (
        <div className="space-y-2">
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Your response..."
            className="w-full p-2 text-sm border border-amber-300 rounded resize-none bg-white"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!response.trim()}
              className="px-4 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit
            </button>
            {onVoiceResponse && (
              <button
                onClick={() => setShowVoice(true)}
                className="px-4 py-2 border border-amber-300 text-amber-800 text-sm rounded hover:bg-amber-100 flex items-center gap-1"
              >
                <MicrophoneIcon className="w-4 h-4" />
                Voice Response
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
