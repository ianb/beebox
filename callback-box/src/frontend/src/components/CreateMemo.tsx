/**
 * Form for creating a new memo.
 */

import { useState } from "react";
import { createCard } from "../api";

interface CreateMemoProps {
  onCreated: () => void;
}

export function CreateMemo({ onCreated }: CreateMemoProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim()) {
      setError("Please enter some content");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Generate a name from timestamp
      const now = new Date();
      const name = `Memo_${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
      const path = `box/inbox/${name}.memo.card`;

      await createCard({ path, template: "memo", content: content.trim() });

      setContent("");
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-bold text-gray-900 mb-4">New Memo</h3>

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's on your mind?"
            className="input w-full h-32 resize-none"
            disabled={submitting}
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm mb-4">Error: {error}</div>
        )}

        <button
          type="submit"
          disabled={submitting || !content.trim()}
          className="btn btn-primary w-full"
        >
          {submitting ? "Creating..." : "Create Memo"}
        </button>
      </form>
    </div>
  );
}
