/**
 * Form for creating a new memo.
 */

import { useCallback, useState } from "react";
import { trpc } from "../lib/trpc";
import { TextareaField } from "./ui/fields";
import { Button } from "./ui/Button";

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

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-lg font-bold text-warm-900 mb-4">New Memo</h3>

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <TextareaField
            label="Memo content"
            value={content}
            onChange={setContent}
            placeholder="What's on your mind?"
            rows={6}
            disabled={createMutation.isPending}
            error={error !== null ? error : undefined}
            inputClassName="resize-none"
          />
        </div>

        <Button
          type="submit"
          intent="primary"
          fullWidth
          disabled={!content.trim()}
          loading={createMutation.isPending}
          loadingLabel="Creating…"
        >
          Create Memo
        </Button>
      </form>
    </div>
  );
}
