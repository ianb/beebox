/**
 * Built-in FileType registrations — icon-only for v1, no custom ListComponents
 * except for the image-card demo (added separately).
 */

import { registerFileType } from "./registry";
import {
  DocumentIcon,
  CardIcon,
  ImageIcon,
  AudioIcon,
  DirectoryIcon,
  JobIcon,
  QuestionIcon,
} from "./icons";
import { ImageCardListEntry } from "../components/file-entries/ImageCardListEntry";
import type { ImageAttrs } from "../../../schemas/image";

let registered = false;

export function registerBuiltinFileTypes(): void {
  if (registered) return;
  registered = true;

  registerFileType({ type: "memo" }, { icon: DocumentIcon });
  registerFileType<ImageAttrs>({ type: "image" }, {
    icon: ImageIcon,
    ListComponent: ImageCardListEntry,
  });
  registerFileType({ type: "audio" }, { icon: AudioIcon });
  registerFileType({ type: "question" }, { icon: QuestionIcon });
  registerFileType({ type: "email-message" }, { icon: DocumentIcon });
  registerFileType({ type: "email-thread" }, { icon: DocumentIcon });
  registerFileType({ type: "recipe" }, { icon: DocumentIcon });
  registerFileType({ type: "record" }, { icon: CardIcon });
  registerFileType({ type: "gsheet" }, { icon: CardIcon });
  registerFileType({ type: "doc" }, { icon: DocumentIcon });
  registerFileType({ type: "gdoc" }, { icon: DocumentIcon });
  registerFileType({ type: "procedure" }, { icon: JobIcon });
  registerFileType({ type: "procedure-run" }, { icon: JobIcon });
  registerFileType({ type: "chat-job" }, { icon: JobIcon });
  registerFileType({ type: "intake-job" }, { icon: JobIcon });
  registerFileType({ type: "question-followup-job" }, { icon: JobIcon });
  registerFileType({ type: "todo-list" }, { icon: CardIcon });
  registerFileType({ type: "briefing" }, { icon: DocumentIcon });
  registerFileType({ type: "person" }, { icon: CardIcon });
  registerFileType({ type: "feedback" }, { icon: DocumentIcon });
  registerFileType({ type: "guide" }, { icon: DocumentIcon });
  registerFileType({ type: "file" }, { icon: DocumentIcon });
  registerFileType({ type: "telegram-message" }, { icon: DocumentIcon });

  registerFileType({ match: (p: string) => p.endsWith(".md") }, { icon: DocumentIcon });
  registerFileType({ match: (p: string) => p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".png") || p.endsWith(".gif") || p.endsWith(".webp") }, { icon: ImageIcon });
  registerFileType({ match: (p: string) => p.endsWith(".m4a") || p.endsWith(".mp3") || p.endsWith(".wav") || p.endsWith(".ogg") }, { icon: AudioIcon });
  registerFileType({ match: (p: string) => p.endsWith("/") }, { icon: DirectoryIcon });
}
