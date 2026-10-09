/**
 * `bakeoff judge`: score every blind answer in a run against the corpus's
 * checks with a text-only judge. The judge sees what each recording was meant
 * to contain and the answer, never the model's name. Writes <run>/judged.json;
 * re-running resumes.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type CallRecord,
  type Check,
  type Corpus,
  type Judged,
  type RawRun,
  type Verdict,
  callKey,
  checksFor,
  loadCorpus,
  pool,
  readJson,
  requireEnv,
  sampleById,
  writeJson,
} from "./lib.ts";

function judgePrompt(corpus: Corpus, call: CallRecord, checks: Check[]): string {
  const recordings = Object.entries(call.labels).map(([label, id]) => {
    const s = sampleById(corpus, id);
    if (s.synthetic) return `Recording ${label}: synthetic audio — ${s.title}. Contains no speech.`;
    return `Recording ${label}: "${s.title}". Intended script: ${s.words ?? ""}\nPerformer's direction: ${s.direction ?? ""}\nWhat a good answer recognizes: ${s.expected}`;
  });
  return [
    "You are scoring an audio model's answer about one or more voice recordings. You cannot hear the audio. Below is what each recording was designed to contain, a list of pass/fail checks, and the model's answer. The script is what the speaker intended; the performance may add fillers, breaths, or reductions, which are not errors.",
    "",
    "## Recordings",
    ...recordings,
    "",
    "## Checks",
    ...checks.map((c) => `- ${c.id}: ${c.check}`),
    "",
    "## Model answer",
    call.text ?? "",
    "",
    'Judge each check strictly from the answer\'s text. Respond with JSON only: {"verdicts": [{"id": "<check id>", "pass": true|false, "note": "<one short sentence citing the answer>"}]}',
  ].join("\n");
}

async function judgeOne(corpus: Corpus, call: CallRecord, checks: Check[]): Promise<Verdict[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${requireEnv("BBX_OPENROUTER_API_KEY")}` },
        body: JSON.stringify({
          model: corpus.judgeModel,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: judgePrompt(corpus, call, checks) }],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const json = (await res.json()) as { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
      if (!res.ok || json.error) throw new Error(`HTTP ${res.status}: ${json.error?.message ?? ""}`);
      const content = json.choices?.[0]?.message?.content ?? "";
      // The judge sometimes wraps its JSON in prose or a code fence.
      const object = /\{[\s\S]*\}/.exec(content)?.[0];
      if (!object) throw new Error(`judge returned no JSON: ${content.slice(0, 80)}`);
      const verdicts = (JSON.parse(object) as { verdicts?: Verdict[] }).verdicts ?? [];
      return checks.map((c) => {
        const v = verdicts.find((x) => x.id === c.id);
        if (!v) throw new Error(`judge omitted ${c.id}`);
        return v;
      });
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

/** `tasks` limits judging to those groups; `redo` re-judges them (after editing their checks). */
export async function judgeCommand(opts: { run: string; concurrency: number; tasks?: string[] | undefined; redo: boolean }): Promise<boolean> {
  const corpus = loadCorpus();
  const run = readJson<RawRun>(join(opts.run, "raw.json"));
  const outFile = join(opts.run, "judged.json");
  const judged: Judged = existsSync(outFile) ? readJson<Judged>(outFile) : {};
  const selected = run.calls.filter((c) => c.mode === "blind" && !c.error && (!opts.tasks || opts.tasks.includes(c.task)));
  // A redo drops the old verdicts first, so a failed re-judge cannot leave a stale verdict counted.
  if (opts.redo) for (const c of selected) delete judged[callKey(c)];
  const todo = selected.filter((c) => !judged[callKey(c)]);
  console.log(`${todo.length} answers to judge`);
  let failures = 0;
  await pool(todo, opts.concurrency, async (call) => {
    try {
      judged[callKey(call)] = await judgeOne(corpus, call, checksFor(corpus, call.task));
      writeJson(outFile, Object.fromEntries(Object.entries(judged).sort(([a], [b]) => a.localeCompare(b))));
      console.log(`ok   ${callKey(call)}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${callKey(call)} ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return failures === 0;
}
