/** States the ordinary card view reaches through authored content or transient workspace UI. */

import { Accordion } from "../../../../components/ui/Accordion";
import { Text } from "../../../../components/ui/Text";
import { Hint } from "../../../../components/ui/Hint";
import { Button } from "../../../../components/ui/Button";
import { Markdown } from "../../../../components/Markdown/body";

const QUOTES = `{% quote treatment="inset" %}
A short quotation set into the paper.
{% /quote %}

{% quote treatment="plain" %}
An unframed quotation stays with its paragraph.
{% /quote %}

> Dana repeated the opening time.
>
> > Ten o'clock, before the hall gets busy.
>
> {% quote treatment="plain" %}
> Leave the first table by the door.
> {% /quote %}

{% quote treatment="inset" %}
> Lee will bring spare tape.

{% quote treatment="plain" %}
Put a pen beside every stack of labels.
{% /quote %}
{% /quote %}`;

/** The quote tags and Markdown blockquotes use these same elements in document bodies. */
export function QuoteSpecimens() {
  return <div className="bbx-card-content"><Markdown prose="block" onNavigate={() => {}}>{QUOTES}</Markdown></div>;
}

/** Matches canvas-loop/src/react/SketchFigure/figure/view.tsx error markup; mounting its owner would require a throwing sketch. */
export function FigureErrorSpecimen() {
  return <div className="bbx-figure-mount"><div className="cl-error" role="alert">Sketch error: a sample value could not be drawn.</div></div>;
}

/** Matches FileView/AgentViewRenderer.tsx's view host; mounting its owner would execute a box-authored module. */
export function WorkspaceSpecimens() {
  return <div className="bbx-card-view" data-view-layout="inset">A small embedded card view.</div>;
}

/** Transparent accordion controls inherit the card material. */
export function AccordionSpecimens() {
  return <div id="bbx-theme-studio-accordions" className="space-y-3">
    <Accordion id="bbx-studio-material-accordion" defaultOpen title={<Text size="sm">Details on the card</Text>}>
      <Hint>A hint on the card material.</Hint>
      <Button id="bbx-studio-material-ghost" intent="ghost" size="sm">Card action</Button>
    </Accordion>
  </div>;
}
