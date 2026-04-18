/**
 * ReadingFeedback - Completion UI with overall rating and reaction selection.
 */

import { useState } from "react";
import type { GuideReaction, BriefReaction } from "./types";

export function ReadingFeedback({
  guideReactions,
  briefReactions,
  onComplete,
}: {
  guideReactions: GuideReaction[];
  briefReactions: BriefReaction[];
  onComplete: (rating: "great" | "ok" | "meh", selectedReactions: Array<{ id: string; source: "guide" | "brief" }>) => void;
}) {
  const [selectedRating, setSelectedRating] = useState<"great" | "ok" | "meh" | null>(null);
  const [selectedReactions, setSelectedReactions] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggleReaction = (id: string) => {
    setSelectedReactions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!selectedRating) return;
    setSubmitting(true);

    const reactions: Array<{ id: string; source: "guide" | "brief" }> = [];
    for (const id of selectedReactions) {
      if (guideReactions.some((r) => r.id === id)) {
        reactions.push({ id, source: "guide" });
      } else if (briefReactions.some((r) => r.id === id)) {
        reactions.push({ id, source: "brief" });
      }
    }

    onComplete(selectedRating, reactions);
  };

  return (
    <div className="space-y-4">
      {/* Overall rating */}
      <div>
        <p className="text-sm font-medium text-warm-700 mb-2">How was this brief?</p>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedRating("great")}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              selectedRating === "great"
                ? "bg-success-100 border-success text-success-dark"
                : "border-warm-400 hover:bg-warm-50"
            }`}
          >
            Great
          </button>
          <button
            onClick={() => setSelectedRating("ok")}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              selectedRating === "ok"
                ? "bg-info-100 border-primary text-primary-dark"
                : "border-warm-400 hover:bg-warm-50"
            }`}
          >
            OK
          </button>
          <button
            onClick={() => setSelectedRating("meh")}
            className={`px-4 py-2 rounded-lg border transition-colors ${
              selectedRating === "meh"
                ? "bg-warning-100 border-warning text-warning-dark"
                : "border-warm-400 hover:bg-warm-50"
            }`}
          >
            Meh
          </button>
        </div>
      </div>

      {/* Reactions */}
      {(guideReactions.length > 0 || briefReactions.length > 0) && (
        <div>
          <p className="text-sm font-medium text-warm-700 mb-2">Anything stand out? (optional)</p>
          <div className="flex flex-wrap gap-2">
            {guideReactions.map((reaction) => (
              <button
                key={reaction.id}
                onClick={() => toggleReaction(reaction.id)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedReactions.has(reaction.id)
                    ? reaction.sentiment === "negative"
                      ? "bg-danger-100 border-danger-light text-danger-dark"
                      : reaction.sentiment === "positive"
                        ? "bg-success-100 border-success-light text-success-dark"
                        : "bg-info-100 border-primary-light text-primary-dark"
                    : "border-warm-400 hover:bg-warm-50"
                }`}
              >
                {reaction.text}
              </button>
            ))}
            {briefReactions.map((reaction) => (
              <button
                key={reaction.id}
                onClick={() => toggleReaction(reaction.id)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedReactions.has(reaction.id)
                    ? "bg-info-100 border-info-light text-info-dark"
                    : "border-warm-400 hover:bg-warm-50"
                }`}
              >
                {reaction.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Submit */}
      <div className="pt-2">
        <button
          onClick={handleSubmit}
          disabled={!selectedRating || submitting}
          className="px-5 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Saving..." : "Done Reading"}
        </button>
      </div>
    </div>
  );
}
