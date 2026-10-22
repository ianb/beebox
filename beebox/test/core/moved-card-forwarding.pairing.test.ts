import t from "tap";
import { rename, writeFile } from "node:fs/promises";
import { makeTmpBox } from "../helpers/test-helpers.js";
import { pairedSuccessor, resolveMovedCardPath, type NameStatusRecord } from "../../src/core/moved-card-forwarding.js";

const D = (path: string): NameStatusRecord => ({ status: "D", paths: [path] });
const A = (path: string): NameStatusRecord => ({ status: "A", paths: [path] });
const R = (from: string, to: string): NameStatusRecord => ({ status: "R", paths: [from, to] });

t.test("a delete pairs with the one same-type card the commit added", async (st) => {
  st.equal(pairedSuccessor([D("loans/Mystery.loan.card"), A("loans/Piranesi.loan.card"), A("notes/x.doc.card")], "loans/Mystery.loan.card"),
    "loans/Piranesi.loan.card");
});

t.test("no pairing without a delete, a same-type add, or a card-shaped source", async (st) => {
  st.equal(pairedSuccessor([A("loans/Piranesi.loan.card")], "loans/Mystery.loan.card"), null);
  st.equal(pairedSuccessor([D("loans/Mystery.loan.card"), A("notes/Piranesi.doc.card")], "loans/Mystery.loan.card"), null);
  st.equal(pairedSuccessor([D("loans/readme.md"), A("loans/other.md")], "loans/readme.md"), null);
});

t.test("a card added to trash is not a successor", async (st) => {
  st.equal(pairedSuccessor([D("loans/Mystery.loan.card"), A("_bookkeeping/trash/2026/Mystery.loan.card")], "loans/Mystery.loan.card"), null);
});

t.test("a trashed card has no successor, even with one same-type add", async (st) => {
  const source = "loans/Mystery.loan.card";
  st.equal(pairedSuccessor([D(source), A("_bookkeeping/trash/2026/Mystery.loan.card"), A("loans/Piranesi.loan.card")], source), null,
    "trash add with the source's name");
  st.equal(pairedSuccessor([D(source), R(source, "_bookkeeping/trash/2026/Mystery.loan.card"), A("loans/Piranesi.loan.card")], source), null,
    "rename into trash");
  st.equal(pairedSuccessor([D(source), A("_bookkeeping/trash/2026/Other.loan.card"), A("loans/Piranesi.loan.card")], source),
    "loans/Piranesi.loan.card", "trashing a different card does not block pairing");
});

t.test("two same-type adds are ambiguous unless the attach folder follows one", async (st) => {
  const base = [D("loans/Mystery.loan.card"), A("loans/Piranesi.loan.card"), A("loans/Other.loan.card")];
  st.equal(pairedSuccessor(base, "loans/Mystery.loan.card"), null);
  st.equal(pairedSuccessor([...base, R("loans/Mystery.attach/cover.jpg", "loans/Piranesi.attach/cover.jpg")], "loans/Mystery.loan.card"),
    "loans/Piranesi.loan.card");
});

t.test("a move and an edit in one commit forwards to the new card", async (st) => {
  const box = await makeTmpBox({ git: true });
  await box.seed("_content/loans/Mystery.loan.card", "---\ntitle: Mystery book\nlent-to: Sam\n---\nA book.\n");
  box.commitAll("lend a book");
  await rename(box.path("_content/loans/Mystery.loan.card"), box.path("_content/loans/Piranesi.loan.card"));
  await writeFile(box.path("_content/loans/Piranesi.loan.card"), "---\ntitle: Piranesi\nlent-to: Sam\nauthor: Susanna Clarke\n---\nThe mystery book is Piranesi, a novel about a house of endless halls.\n");
  box.commitAll("identify the book");

  st.same(await resolveMovedCardPath({ boxRoot: box.root, missingPath: "_content/loans/Mystery.loan.card" }),
    { kind: "moved", path: "_content/loans/Piranesi.loan.card" });
});
