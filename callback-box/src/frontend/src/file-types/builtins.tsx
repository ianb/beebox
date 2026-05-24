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

  registerFileType({ tagName: "memo" }, { icon: DocumentIcon });
  registerFileType<ImageAttrs>({ tagName: "image" }, {
    icon: ImageIcon,
    ListComponent: ImageCardListEntry,
  });
  registerFileType({ tagName: "audio" }, { icon: AudioIcon });
  registerFileType({ tagName: "question" }, { icon: QuestionIcon });
  registerFileType({ tagName: "email-message" }, { icon: DocumentIcon });
  registerFileType({ tagName: "email-thread" }, { icon: DocumentIcon });
  registerFileType({ tagName: "recipe" }, { icon: DocumentIcon });
  registerFileType({ tagName: "record" }, { icon: CardIcon });
  registerFileType({ tagName: "sheet" }, { icon: CardIcon });
  registerFileType({ tagName: "doc" }, { icon: DocumentIcon });
  registerFileType({ tagName: "gdoc" }, { icon: DocumentIcon });
  registerFileType({ tagName: "procedure" }, { icon: JobIcon });
  registerFileType({ tagName: "procedure-run" }, { icon: JobIcon });
  registerFileType({ tagName: "chat-job" }, { icon: JobIcon });
  registerFileType({ tagName: "intake-job" }, { icon: JobIcon });
  registerFileType({ tagName: "calendar-review-job" }, { icon: JobIcon });
  registerFileType({ tagName: "question-followup-job" }, { icon: JobIcon });
  registerFileType({ tagName: "todo-list" }, { icon: CardIcon });
  registerFileType({ tagName: "briefing" }, { icon: DocumentIcon });
  registerFileType({ tagName: "person" }, { icon: CardIcon });
  registerFileType({ tagName: "feedback" }, { icon: DocumentIcon });
  registerFileType({ tagName: "guide" }, { icon: DocumentIcon });
  registerFileType({ tagName: "file" }, { icon: DocumentIcon });
  registerFileType({ tagName: "telegram-message" }, { icon: DocumentIcon });

  registerFileType({ match: (p: string) => p.endsWith(".md") }, { icon: DocumentIcon });
  registerFileType({ match: (p: string) => p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".png") || p.endsWith(".gif") || p.endsWith(".webp") }, { icon: ImageIcon });
  registerFileType({ match: (p: string) => p.endsWith(".m4a") || p.endsWith(".mp3") || p.endsWith(".wav") || p.endsWith(".ogg") }, { icon: AudioIcon });
  registerFileType({ match: (p: string) => p.endsWith("/") }, { icon: DirectoryIcon });
}
