/**
 * Form for creating a new memo.
 */

import { useCallback, useState } from "react";
import { trpc } from "../lib/trpc";

interface CreateMemoProps {
  onCreated: () => void;
}

export function CreateMemo({ onCreated }: CreateMemoProps) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.actions.create.useMutation({
    onSuccess: () => {
      setContent("");
      onCreated();
    },
    onError: (err) => setError(err.message),
  });

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = content.trim();
    if (!trimmed) {
      setError("Please enter some content");
      return;
    }

    setError(null);

    // Generate a name from timestamp
    const now = new Date();
    const name = `Memo_${now.toISOString().replace(/[.:]/g, "-").slice(0, 19)}`;
    const cardPath = `box/inbox/${name}.memo.card`;

    createMutation.mutate({ path: cardPath, template: "memo", args: { content: trimmed } });
  }, [content, createMutation]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  }, []);

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-bold text-warm-900 mb-4">New Memo</h3>

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <textarea
            value={content}
            onChange={handleChange}
            placeholder="What's on your mind?"
            className="input w-full h-32 resize-none"
            disabled={createMutation.isPending}
          />
        </div>

        {error ? (
          <div className="text-red-600 text-sm mb-4">Error: {error}</div>
        ) : null}

        <button
          type="submit"
          disabled={createMutation.isPending || !content.trim()}
          className="btn btn-primary w-full"
        >
          {createMutation.isPending ? "Creating..." : "Create Memo"}
        </button>
      </form>
    </div>
  );
}
