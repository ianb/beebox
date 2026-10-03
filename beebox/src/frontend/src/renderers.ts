/**
 * The renderer registry: every `src/renderers/` member, in the order the old
 * side-effect `renderers/setup.ts` imported them (equal-priority renderers
 * keep their current tie-break order — `ordered: true`). Replaces
 * `renderers/setup.ts` (side-effect import list) and `renderers/index.ts`
 * (barrel); each renderer module now exports a data value instead of
 * registering itself at import.
 */
import { defineRegistry } from "@shared/registry.js";
import { registerFileType, type RendererEntry } from "./file-type-registry.js";
import { sourceRenderer } from "./renderers/builtins.js";
import { markdownCardRenderer } from "./renderers/markdown-card.js";
import { commentaryRenderer } from "./renderers/commentary.js";
import { webpageRenderer } from "./renderers/webpage.js";
import { extfileRenderer } from "./renderers/extfile.js";
import { imageCardRenderer, rawImageRenderer } from "./renderers/image.js";
import { pdfRenderer } from "./renderers/pdf.js";
import { recipeRenderer } from "./renderers/recipe.js";
import { pdfCardTextRenderer, pdfCardOriginalRenderer } from "./renderers/pdf-card.js";
import { doclingStructureRenderer, doclingRawJsonRenderer } from "./renderers/docling.js";
import { figureRenderer } from "./renderers/figure.js";
import { conceptMapRenderer } from "./renderers/concept-map.js";
import { gsheetRenderer } from "./renderers/gsheet.js";
import { gfolderRenderer } from "./renderers/gfolder.js";
import { glinkRenderer } from "./renderers/glink.js";
import { markdownRenderer } from "./renderers/markdown.js";
import { commentsRenderer } from "./renderers/comments.js";
import { jsonRenderer } from "./renderers/json.js";
import { plaintextRenderer } from "./renderers/plaintext.js";
import { binaryRenderer } from "./renderers/binary.js";
import { directoryRenderer } from "./renderers/directory.js";
import { todoViewRenderer } from "./renderers/todo-view.js";
import { viewRenderer } from "./renderers/view.js";
import { chatHuskRenderer } from "./renderers/chat-husk.js";
import { questionRenderer } from "./renderers/question.js";
import { tabArrangementRenderer } from "./renderers/tab-arrangement.js";
import { browserTaskRenderer } from "./renderers/browser-task.js";
import { publicationRenderer } from "./renderers/publication.js";
import {
  dashboardRenderer,
  settingsRenderer,
  questionsRenderer,
  landmarksRenderer,
  historyCardRenderer,
  inventoryRenderer,
  adminRenderer,
} from "./renderers/system-cards.js";
import { browseRenderer } from "./renderers/browse.js";
import { searchRenderer } from "./renderers/search.js";

const rendererRegistrations = defineRegistry<RendererEntry>({
  directory: "./renderers",
  ordered: true, // equal-priority renderers keep this tie-break order (was renderers/setup.ts's import order)
  key: (entry) => ("type" in entry.selector ? `${entry.selector.type}:${entry.renderer.name}` : entry.renderer.name),
  members: [
    sourceRenderer,
    markdownCardRenderer,
    commentaryRenderer,
    webpageRenderer,
    extfileRenderer,
    imageCardRenderer,
    rawImageRenderer,
    pdfRenderer,
    recipeRenderer,
    pdfCardTextRenderer,
    pdfCardOriginalRenderer,
    doclingStructureRenderer,
    doclingRawJsonRenderer,
    figureRenderer,
    conceptMapRenderer,
    gsheetRenderer,
    gfolderRenderer,
    glinkRenderer,
    markdownRenderer,
    commentsRenderer,
    jsonRenderer,
    plaintextRenderer,
    binaryRenderer,
    directoryRenderer,
    todoViewRenderer,
    viewRenderer,
    chatHuskRenderer,
    questionRenderer,
    tabArrangementRenderer,
    browserTaskRenderer,
    publicationRenderer,
    dashboardRenderer,
    settingsRenderer,
    questionsRenderer,
    landmarksRenderer,
    historyCardRenderer,
    inventoryRenderer,
    adminRenderer,
    browseRenderer,
    searchRenderer,
  ],
});

let installed = false;

/** One-time loader: registers every renderer with the shared dispatch store. */
export function installRenderers(): void {
  if (installed) return;
  installed = true;
  for (const entry of rendererRegistrations.list) {
    registerFileType(entry.selector, { renderer: entry.renderer });
  }
}
