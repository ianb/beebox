/**
 * Action modal — overlay wrapping CommandRunner or NewMemo form.
 */

import { useState } from "react";
import { CommandRunner } from "../CommandRunner";
import { NewMemo, buildCreateCommandLabel, type MemoCommandArgs } from "../NewMemo";
import { ProcessNewsForm, buildProcessNewsLabel, type ProcessNewsArgs } from "../ProcessNewsForm";
import { CloseButton } from "../ui/CloseButton";

export type ActionType = "wakeup" | "sync" | "create-memo" | "process-news" | null;

interface ActionModalProps {
  action: ActionType;
  onClose: () => void;
  onComplete: () => void;
  newsInboxCount?: number;
  newsPoolCount?: number;
}

function ModalContent({ action, onComplete, onClose, newsInboxCount, newsPoolCount }: ActionModalProps & { action: NonNullable<ActionType> }) {
  const [memoArgs, setMemoArgs] = useState<MemoCommandArgs | null>(null);
  const [newsArgs, setNewsArgs] = useState<ProcessNewsArgs | null>(null);

  if (action === "wakeup") {
    return (
      <CommandRunner
        command="wakeup"
        onComplete={onComplete}
        onClose={onClose}
        autoRun
        className="h-full"
      />
    );
  }

  if (action === "sync") {
    return (
      <CommandRunner
        command="sync"
        onComplete={onComplete}
        onClose={onClose}
        autoRun
        className="h-full"
      />
    );
  }

  if (action === "create-memo") {
    if (memoArgs) {
      return (
        <CommandRunner
          command="create"
          args={memoArgs as unknown as Record<string, unknown>}
          label={buildCreateCommandLabel(memoArgs)}
          onComplete={onComplete}
          onClose={onClose}
          autoRun
          className="h-full"
        />
      );
    }
    return <NewMemo onSubmit={setMemoArgs} onClose={onClose} />;
  }

  if (action === "process-news") {
    if (newsArgs) {
      return (
        <CommandRunner
          command="process-news"
          args={newsArgs as unknown as Record<string, unknown>}
          label={buildProcessNewsLabel(newsArgs)}
          onComplete={onComplete}
          onClose={onClose}
          autoRun
          className="h-full"
        />
      );
    }
    return (
      <ProcessNewsForm
        onSubmit={setNewsArgs}
        onClose={onClose}
        inboxCount={newsInboxCount ?? 0}
        poolCount={newsPoolCount ?? 0}
      />
    );
  }

  return null;
}

export function ActionModal({ action, onClose, onComplete, newsInboxCount = 0, newsPoolCount = 0 }: ActionModalProps) {
  if (!action) return null;

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-warm-700">
            {action === "wakeup" && "cb wakeup"}
            {action === "sync" && "cb sync"}
            {action === "create-memo" && "New Memo"}
            {action === "process-news" && "cb process-news"}
          </h2>
          <CloseButton onClick={onClose} size="sm" />
        </div>

        <div className="flex-1 overflow-auto p-4">
          <ModalContent
            action={action}
            onClose={onClose}
            onComplete={onComplete}
            newsInboxCount={newsInboxCount}
            newsPoolCount={newsPoolCount}
          />
        </div>
      </div>
    </div>
  );
}
