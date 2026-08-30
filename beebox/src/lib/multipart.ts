/**
 * Multipart/form-data body builder — pure, no IO beyond boundary
 * generation (`Math.random`). Extracted from the Whisper and Voxtral
 * transcription clients, which had each hand-rolled a byte-identical
 * builder: same boundary format, same file-part layout, same field-part
 * layout, same trailing boundary. This is the single implementation both
 * now call; the two callers still choose their own part names/values,
 * order, and which optional fields to include.
 */

export interface MultipartFilePart {
  /** Form field name for the file (both existing call sites use "file"). */
  name: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartFieldPart {
  name: string;
  value: string;
}

export type MultipartPart =
  | { kind: "file"; file: MultipartFilePart }
  | { kind: "field"; field: MultipartFieldPart };

export interface MultipartForm {
  body: Buffer<ArrayBuffer>;
  boundary: string;
}

function renderFilePart(boundary: string, file: MultipartFilePart): Buffer[] {
  return [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.data,
    Buffer.from("\r\n"),
  ];
}

function renderFieldPart(boundary: string, field: MultipartFieldPart): Buffer {
  return Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field.name}"\r\n\r\n` +
      `${field.value}\r\n`,
  );
}

/**
 * Build a multipart/form-data body from an ordered list of parts, plus the
 * boundary string to put in the request's `Content-Type` header. Parts are
 * rendered in the given order — callers control field order and which
 * optional fields are present; this only owns the wire-format bytes.
 */
export function buildMultipartForm(
  parts: MultipartPart[],
): MultipartForm {
  const boundary = "----FormBoundary" + Math.random().toString(36).substring(2);
  const chunks: Buffer[] = [];
  for (const part of parts) {
    switch (part.kind) {
      case "file":
        chunks.push(...renderFilePart(boundary, part.file));
        break;
      case "field":
        chunks.push(renderFieldPart(boundary, part.field));
        break;
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), boundary };
}
