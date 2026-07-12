/**
 * Built-in FileType registrations — icon-only for v1, no custom ListComponents
 * except for the image-card demo (added separately).
 */

import { ImageCardListEntry } from "../components/file-entries/ImageCardListEntry";
import type { ImageAttrs } from "@schemas/image";
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

let registered = false;

export function registerBuiltinFileTypes(): void {
  if (registered) return;
  registered = true;

  registerFileType({ type: "memo" }, { listUI: { icon: DocumentIcon } });
  registerFileType<ImageAttrs>({ type: "image" }, {
    listUI: { icon: ImageIcon, ListComponent: ImageCardListEntry },
  });
  registerFileType({ type: "audio" }, { listUI: { icon: AudioIcon } });
  registerFileType({ type: "question" }, { listUI: { icon: QuestionIcon } });
  registerFileType({ type: "email-message" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "email-thread" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "recipe" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "record" }, { listUI: { icon: CardIcon } });
  registerFileType({ type: "gsheet" }, { listUI: { icon: CardIcon } });
  registerFileType({ type: "doc" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "gdoc" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "procedure" }, { listUI: { icon: JobIcon } });
  registerFileType({ type: "procedure-run" }, { listUI: { icon: JobIcon } });
  registerFileType({ type: "chat-job" }, { listUI: { icon: JobIcon } });
  registerFileType({ type: "intake-job" }, { listUI: { icon: JobIcon } });
  registerFileType({ type: "question-followup-job" }, { listUI: { icon: JobIcon } });
  registerFileType({ type: "todo-list" }, { listUI: { icon: CardIcon } });
  registerFileType({ type: "briefing" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "person" }, { listUI: { icon: CardIcon } });
  registerFileType({ type: "feedback" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "guide" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "file" }, { listUI: { icon: DocumentIcon } });
  registerFileType({ type: "telegram-message" }, { listUI: { icon: DocumentIcon } });

  registerFileType({ match: (p: string) => p.endsWith(".md") }, { listUI: { icon: DocumentIcon } });
  registerFileType({ match: (p: string) => p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".png") || p.endsWith(".gif") || p.endsWith(".webp") }, { listUI: { icon: ImageIcon } });
  registerFileType({ match: (p: string) => p.endsWith(".m4a") || p.endsWith(".mp3") || p.endsWith(".wav") || p.endsWith(".ogg") }, { listUI: { icon: AudioIcon } });
  registerFileType({ match: (p: string) => p.endsWith("/") }, { listUI: { icon: DirectoryIcon } });
}
