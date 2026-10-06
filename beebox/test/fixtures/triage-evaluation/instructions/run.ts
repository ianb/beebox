/** Synthetic-only paired instruction experiment; no box or routing mutations. */
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseArgs, parseEnv } from "node:util";
import { z } from "zod";
import { createFakeJev, createJevService } from "../../../../src/services/jev.js";
import { serializeJudgeRequest, type JudgeInput } from "../../../../src/services/jev-judge.js";
import { invariant } from "../../../../src/shared/invariant.js";

const { values } = parseArgs({ options: { out: { type: "string" }, "key-env-file": { type: "string" } } });
invariant(values.out, "--out must name a fresh output directory");
const source = await fs.readFile(new URL("protocol.json", import.meta.url), "utf8");
const rules = z.record(z.string(), z.string());
const schema = z.object({
  purpose: z.string(), repeats: z.number().int().positive(), shared: z.string(), question: z.string(),
  baselineRules: rules, preciseRules: rules, policies: rules,
  conditions: z.array(z.object({ id: z.string(), rules: z.enum(["baselineRules", "preciseRules"]), policy: z.string(), omitUnclear: z.boolean() })),
  cases: z.array(z.object({ id: z.string(), split: z.string(), body: z.string(), preparation: z.string().optional(), expected: z.string(), bestExpected: z.string().optional(), broadUnspecified: z.boolean().optional() })),
});
const protocol = schema.parse(JSON.parse(source));
await fs.mkdir(values.out, { recursive: false });
await fs.writeFile(`${values.out}/protocol.json`, source);
const service = createFakeJev();
const keyFile = values["key-env-file"];
const live = keyFile !== undefined;
const getService = async () => {
  if (keyFile === undefined) return service;
  const env = parseEnv(await fs.readFile(keyFile, "utf8"));
  const apiKey = env["BBX_OPENROUTER_API_KEY"];
  invariant(apiKey, "authorized key file lacks BBX_OPENROUTER_API_KEY");
  return createJevService({ apiKey });
};
const judge = await getService();
let errors = 0;
// Rotate condition order each repeat; interleave conditions per case.
for (let repeat = 0; repeat < protocol.repeats; repeat++) {
  for (const item of protocol.cases) {
    const conditions = [...protocol.conditions.slice(repeat), ...protocol.conditions.slice(0, repeat)];
    for (const condition of conditions) {
      const criteria = { ...protocol[condition.rules] };
      if (condition.omitUnclear) delete criteria["unclear"];
      const policy = protocol.policies[condition.policy];
      invariant(policy, "condition references missing policy");
      const input: JudgeInput = {
        situation: protocol.purpose,
        instructions: [protocol.shared, policy],
        state: { body: item.body, preparation: item.preparation ?? "complete supplied text" },
        questions: { destination: { type: "choice", instructions: protocol.question, criteria } },
      };
      const request = serializeJudgeRequest(input);
      const expected = condition.policy === "bestEffort" ? item.bestExpected ?? item.expected : item.expected;
      const scorable = expected in criteria && !(condition.rules === "baselineRules" && item.broadUnspecified);
      const record = { scorable, repeat, id: item.id, split: item.split, condition: condition.id, expected, input, requestHash: createHash("sha256").update(request).digest("hex") };
      const start = performance.now();
      try {
        const result = await judge.judge(input);
        await fs.appendFile(`${values.out}/results.jsonl`, JSON.stringify({ ...record, result, elapsedMs: Math.round(performance.now() - start) }) + "\n");
      } catch (error) {
        errors++;
        await fs.appendFile(`${values.out}/results.jsonl`, JSON.stringify({ ...record, error: String(error) }) + "\n");
      }
    }
  }
  console.log(`Completed repeat ${String(repeat + 1)}/${String(protocol.repeats)}; errors=${String(errors)}.`);
}
await fs.writeFile(`${values.out}/run.json`, JSON.stringify({ live, protocolHash: createHash("sha256").update(source).digest("hex"), errors, calls: protocol.repeats * protocol.cases.length * protocol.conditions.length }, null, 2));
if (errors) process.exitCode = 1;
