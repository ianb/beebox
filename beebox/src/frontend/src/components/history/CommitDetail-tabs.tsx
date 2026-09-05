/**
 * CommitDetail — per-file tab views (changed / new / moved) and binary preview.
 */

import { getApiBase } from "../../api";
import { ExternalLink } from "../ui/ExternalLink";
import { Image } from "../ui/Image";
import { Pre } from "../ui/Pre";
import type { DiffFile } from "./CommitDetail-diff";
import { extractNewFileContent } from "./CommitDetail-diff";
import { buildHistoryBlobUrl } from "./history-blob-url";

// --- Binary file rendering ---

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg"];
const AUDIO_EXTS = [".webm", ".m4a", ".mp3", ".wav", ".ogg"];

function getFileExt(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot !== -1 ? filePath.substring(dot).toLowerCase() : "";
}

function BinaryFilePreview({ file, hash }: { file: DiffFile; hash: string }) {
  const ext = getFileExt(file.path);
  // A removed file's content only exists at the parent commit; the blob route
  // accepts a trailing "^" on the hash for exactly this.
  const blobHash = file.meta.includes("deleted") ? `${hash}^` : hash;
  const blobUrl = buildHistoryBlobUrl({ apiBase: getApiBase(), hash: blobHash, filePath: file.path });

  if (IMAGE_EXTS.includes(ext)) {
    return (
      <div className="px-3 py-2">
        <Image src={blobUrl} lightboxSrc={blobUrl} alt={file.path} size="md" lightbox />
      </div>
    );
  }

  if (AUDIO_EXTS.includes(ext)) {
    return (
      <div className="px-3 py-2">
        <audio controls src={blobUrl} className="w-full max-w-md">
          <track kind="captions" />
        </audio>
      </div>
    );
  }

  const basename = file.path.split("/").pop() ?? file.path;
  return (
    <div className="px-3 py-2">
      <ExternalLink href={blobUrl} download={basename}>
        Download {basename}
      </ExternalLink>
    </div>
  );
}

export function DiffTab({ files, hash }: { files: DiffFile[]; hash: string }) {
  if (files.length === 0) {
    return <div className="text-sm text-warm-500 italic p-4">No edited files</div>;
  }

  return (
    <div className="divide-y divide-warm-300">
      {files.map((file, fi) => (
        <div key={fi}>
          <div className="px-3 py-1.5 bg-warm-50 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-medium text-warm-700">{file.path}</span>
            {file.meta.filter((m) => m !== "new file" && m !== "deleted" && m !== "moved").map((m, mi) => (
              <span key={mi} className="text-[10px] px-1.5 py-0.5 rounded bg-warning-100 text-warning-dark">{m}</span>
            ))}
          </div>
          {file.binary ? (
            <BinaryFilePreview file={file} hash={hash} />
          ) : (
            <div className="px-3 py-1">
              <Pre size="xs">
                {file.hunks.map((line, i) => {
                  let className = "text-warm-700";
                  if (line.startsWith("+")) {
                    className = "text-success-dark bg-success-50";
                  } else if (line.startsWith("-")) {
                    className = "text-danger-dark bg-danger-50";
                  } else if (line.startsWith("@@")) {
                    className = "text-info text-[10px]";
                  }
                  return (
                    <div key={i} className={className}>
                      {line}
                    </div>
                  );
                })}
              </Pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function NewFilesTab({ files, hash }: { files: DiffFile[]; hash: string }) {
  if (files.length === 0) {
    return <div className="text-sm text-warm-500 italic p-4">No new files</div>;
  }

  return (
    <div className="divide-y divide-warm-300">
      {files.map((file, fi) => {
        const content = !file.binary && file.hunks.some((h) => h.trim()) ? extractNewFileContent(file.hunks) : null;

        return (
          <div key={fi}>
            <div className="px-3 py-1.5 bg-success-50 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-success-dark">{file.path}</span>
            </div>
            {file.binary ? (
              <BinaryFilePreview file={file} hash={hash} />
            ) : content ? (
              <div className="px-3 py-1">
                <Pre size="xs">
                  {content.split("\n").map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </Pre>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function MovedTab({ files }: { files: DiffFile[] }) {
  if (files.length === 0) {
    return <div className="text-sm text-warm-500 italic p-4">No moved files</div>;
  }

  return (
    <div className="px-3 py-2">
      {files.map((file, fi) => (
        <div key={fi} className="text-xs text-warm-700 py-0.5">
          {file.move ? (
            <div>
              <div>{file.move.basename} <span className="text-warm-500">moved</span></div>
              <div className="text-warm-500 ml-3">
                {file.move.fromDir} → {file.move.toDir}
              </div>
            </div>
          ) : (
            <div>
              {file.path}
              {file.meta.map((m, mi) => (
                <span key={mi} className="text-warm-500 ml-1">({m})</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
