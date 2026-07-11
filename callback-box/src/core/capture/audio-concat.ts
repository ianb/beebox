/**
 * Per-segment audio chunk concatenation.
 *
 * `MediaRecorder` with a timeslice emits chunks where only the *first* chunk of
 * a recording carries the WebM/EBML header; later chunks are raw Clusters.
 * Concatenating the ordered chunks of one recording yields a valid WebM file;
 * concatenating across two recordings does not (two headers). Each recording
 * start is a "segment", so we concat strictly within a segment.
 *
 * Pure (buffers in, buffers out) so it doctests without touching disk.
 */

export interface SegmentChunks {
  segmentId: string;
  startedAt: string;
  /** Chunk buffers in recording order (header chunk first). */
  chunks: Buffer[];
}

export interface ConcatenatedSegment {
  segmentId: string;
  startedAt: string;
  buffer: Buffer;
}

/** Concatenate one segment's ordered chunks into a single WebM buffer. */
export function concatSegmentChunks(chunks: Buffer[]): Buffer {
  return Buffer.concat(chunks);
}

/**
 * Concatenate each segment's chunks independently, preserving segment order and
 * within-segment chunk order. Segments with no chunks are dropped.
 */
export function concatSegments(segments: SegmentChunks[]): ConcatenatedSegment[] {
  const result: ConcatenatedSegment[] = [];
  for (const segment of segments) {
    if (segment.chunks.length === 0) continue;
    result.push({
      segmentId: segment.segmentId,
      startedAt: segment.startedAt,
      buffer: concatSegmentChunks(segment.chunks),
    });
  }
  return result;
}
