/**
 * ThumbsFeedback - Thumbs up/down icons and toggle component for item-level feedback.
 */

function ThumbsUpIcon({ className = "w-4 h-4", filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
      />
    </svg>
  );
}

function ThumbsDownIcon({ className = "w-4 h-4", filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.737 3h4.017c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
      />
    </svg>
  );
}

export function ThumbsFeedback({
  id,
  feedback,
  onFeedback,
}: {
  id: string;
  feedback?: "thumbs-up" | "thumbs-down";
  onFeedback: (id: string, value: "thumbs-up" | "thumbs-down" | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-1 ml-2 translate-y-1">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onFeedback(id, feedback === "thumbs-up" ? undefined : "thumbs-up");
        }}
        className={`p-1 rounded transition-colors ${
          feedback === "thumbs-up"
            ? "text-green-600 bg-green-100"
            : "text-gray-400 hover:text-green-600 hover:bg-green-50"
        }`}
        title="Thumbs up"
      >
        <ThumbsUpIcon className="w-4 h-4" filled={feedback === "thumbs-up"} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onFeedback(id, feedback === "thumbs-down" ? undefined : "thumbs-down");
        }}
        className={`p-1 rounded transition-colors ${
          feedback === "thumbs-down"
            ? "text-red-600 bg-red-100"
            : "text-gray-400 hover:text-red-600 hover:bg-red-50"
        }`}
        title="Thumbs down"
      >
        <ThumbsDownIcon className="w-4 h-4" filled={feedback === "thumbs-down"} />
      </button>
    </div>
  );
}
