/**
 * Full-page scrollable viewer for a single card file. Used by the
 * `/:boxSlug/view/<splat>` route via a thin wrapper in app-shell.tsx.
 */

import { FileView } from "./FileView";
import { TextLink } from "./ui/TextLink";
import { Card } from "./ui/Card";

export interface CardViewPanelProps {
  cardPath: string;
  backHref: string;
  backLabel?: string;
}

export function CardViewPanel({ cardPath, backHref, backLabel = "\u2190 Back to Dashboard" }: CardViewPanelProps) {
  return (
    <div className="h-full bg-warm-50 overflow-auto">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <TextLink to={backHref} underline={false} className="block mb-4">{backLabel}</TextLink>
        <Card padding="none" shadow>
          <FileView path={cardPath} />
        </Card>
      </div>
    </div>
  );
}
