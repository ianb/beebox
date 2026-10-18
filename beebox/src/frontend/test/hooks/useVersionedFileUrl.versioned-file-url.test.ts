// # Versioned file URLs
//
// PDF viewers may retain a document by URL, independently of ordinary HTTP
// revalidation. The PDF renderers append the current file ETag to force a new
// viewer document when the file is reopened.

import { test } from "tap";
import "agent-doctest/tap";
import { versionedFileUrl } from "../../src/hooks/useVersionedFileUrl.js";

void test("line 11", async (t) => {
  // doctest:L12
  t.check(versionedFileUrl("/test1/api/files/_content/report.pdf", 'W/"abc-123"'), "/test1/api/files/_content/report.pdf?v=W%2F%22abc-123%22");

  // doctest:L15
  t.check(versionedFileUrl("/test1/api/files/_content/report.pdf", null), "/test1/api/files/_content/report.pdf");

  // doctest:L18
  t.check(versionedFileUrl("/test1/api/files/_content/report.pdf?download=1", 'W/"abc-123"'), "/test1/api/files/_content/report.pdf?download=1&v=W%2F%22abc-123%22");
});
