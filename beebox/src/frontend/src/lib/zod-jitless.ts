/**
 * Turn off zod's JIT before any schema parses. Its first object parse probes
 * `new Function` and, when that works, compiles a fast parser from generated
 * source. Prod's CSP is `script-src 'self'` (report-only today), so the probe
 * and the compile each log an `unsafe-eval` violation, and an enforced policy
 * would block them. The interpreted parser is fast enough for the frontend.
 *
 * Imported first in `main/app.tsx` so it runs before any module that parses.
 */

import { z } from "zod";

z.config({ jitless: true });
