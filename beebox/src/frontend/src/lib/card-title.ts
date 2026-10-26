import { isRecord } from "@shared/is-record";
import { displayName } from "./display-name";
import { questionTitle } from "@shared/question-title";
import type { FileData } from "../file-type-registry";

/**
 * A non-blank `title:`, else a landmark's `navigation.label`, else a question's
 * prompt (`questionTitle`, as the schema's `summarize` does), else a named
 * entity's `name:` (person, place), else the filename. A landmark is headed by its
 * place's name, the label the place pill and the "Go to" buttons show; the
 * same rule titles its summary (`schemas/landmark.ts`), so its tab agrees.
 */
export function cardTitle(data: FileData): string {
  const fm = data.frontmatter;
  if (typeof fm?.title === "string" && fm.title.trim() !== "") return fm.title;
  const label = landmarkLabel(data);
  if (label !== null) return label;
  if (data.path.endsWith(".question.card") && typeof fm?.prompt === "string" && fm.prompt.trim() !== "") return questionTitle(fm.prompt);
  if (typeof fm?.name === "string") return fm.name;
  return displayName(data.path);
}

function landmarkLabel(data: FileData): string | null {
  if (!data.path.endsWith(".landmark.card")) return null;
  const navigation = data.frontmatter?.navigation;
  const label = isRecord(navigation) && typeof navigation.label === "string" ? navigation.label.trim() : "";
  return label === "" ? null : label;
}
