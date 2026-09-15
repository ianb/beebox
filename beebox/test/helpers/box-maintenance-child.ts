import { acquireBoxWork, boxWorkEnvironment } from "../../src/lib/box-maintenance.js";
import { invariant } from "../../src/lib/invariant.js";

const boxRoot = process.argv[2];
invariant(boxRoot !== undefined, "child needs a box root");
const work = await acquireBoxWork(boxRoot, process.env.BBX_BOX_WORK);
process.stdout.write(`${JSON.stringify(work.run(boxWorkEnvironment))}\n`);
process.stdin.once("data", () => {
  void work.release().then(() => process.exit(0)).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
});
process.stdin.resume();
