"""Enumerate every t.check in the suite and flag the mechanical signals from
README section 5. Output: per-check JSONL and per-file CSV under
research/test-value/application/. Flags are candidates for a reader, not
dispositions.

Usage: REPO=<repo root> LEDGER=<ledger.jsonl> python3 -I enumerate.py
"""
import csv, json, os, re, statistics, subprocess, sys
from collections import defaultdict

REPO = os.environ["REPO"]
LEDGER = os.environ.get("LEDGER")
OUT = os.path.join(REPO, "research/test-value/application")

files = subprocess.run(["git", "ls-files", "*.test.ts"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
files = [f for f in files if "/node_modules/" not in f]

BOUNDARY = re.compile(r"(auth|pairing|secret|contain|hub|scan-token|blocklist|token|session|permission|privacy|guard|admission|egress|publish)", re.I)
K1_WORD = re.compile(r"(issues/|20\d\d-\d\d-\d\d|\b[0-9a-f]{7,10}\b|\bbefore\b|used to|regression|incident|bug|flake|red-main|full-suite)", re.I)
ZOD = re.compile(r"(Invalid|Expected|Required|invalid_type|too_small|too_big|unrecognized_keys|Markdoc|validation)", re.I)
WEAK_RHS = re.compile(r"^(true|false|undefined|null|\"ok\"|'ok'|0|1)$")
WEAK_LHS = re.compile(r"(\.success\b|\.length\b|\.includes\(|existsSync\(|\.ok\b|\.size\b|\.has\(|typeof |instanceof |!== undefined|!= null|> 0)")
FLAKE = re.compile(r"(setTimeout|sleep\(|Date\.now\(\)|new Date\(\)|spawn\(|execa|listen\(|performance\.now)")
GEN = re.compile(r"(readdir|package\.json|renderToString|outerHTML|innerHTML)")

def find_calls(src, name):
    """Yield (start, end, argtext) for each `name(` with balanced parens."""
    i = 0
    while True:
        m = re.compile(r"(?<![\w.$])" + re.escape(name) + r"\(").search(src, i)
        if not m:
            return
        j = m.start()
        k = j + len(name) + 1
        depth, instr, esc = 1, None, False
        while k < len(src) and depth:
            c = src[k]
            if instr:
                if esc: esc = False
                elif c == "\\": esc = True
                elif c == instr: instr = None
            else:
                if c in "\"'`": instr = c
                elif c == "(": depth += 1
                elif c == ")": depth -= 1
                elif c == "/" and src[k+1:k+2] == "/":
                    nl = src.find("\n", k); k = nl if nl > 0 else len(src); continue
            k += 1
        yield j, k, src[j + len(name) + 1 : k - 1]
        i = k

def split_args(arg):
    depth, instr, esc, cur, out = 0, None, False, [], []
    for c in arg:
        if instr:
            cur.append(c)
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == instr: instr = None
            continue
        if c in "\"'`": instr = c
        elif c in "([{": depth += 1
        elif c in ")]}": depth -= 1
        elif c == "," and depth == 0:
            out.append("".join(cur).strip()); cur = []; continue
        cur.append(c)
    out.append("".join(cur).strip())
    return out

# per-file durations from the ledger (median over full runs)
dur = defaultdict(list)
if LEDGER and os.path.exists(LEDGER):
    with open(LEDGER) as fh:
        for line in fh:
            try: r = json.loads(line)
            except Exception: continue
            if r.get("mode") != "full": continue
            for f, ms in (r.get("durations") or {}).items():
                dur[f].append(ms)
dur_med = {f: statistics.median(v) / 1000 for f, v in dur.items()}

checks_out = open(os.path.join(OUT, "checks.jsonl"), "w")
rows = []
rhs_index = defaultdict(set)
for path in files:
    src = open(os.path.join(REPO, path), encoding="utf-8", errors="replace").read()
    lines = src.split("\n")
    header = "\n".join(l for l in lines[:40] if l.startswith("//"))
    tests = [(s, e, a) for s, e, a in find_calls(src, "test")]
    test_starts = [s for s, _, _ in tests]
    tests_with_comment = sum(1 for s in test_starts if (lambda ln: ln >= 2 and lines[ln - 2].strip().startswith("//"))(src.count("\n", 0, s) + 1))
    nchecks = 0; flags = defaultdict(int); why = 0
    for s, e, arg in find_calls(src, "t.check"):
        nchecks += 1
        args = split_args(arg)
        lhs = args[0] if args else ""
        rhs = args[1] if len(args) > 1 else ""
        lineno = src.count("\n", 0, s) + 1
        prev = lines[lineno - 2].strip() if lineno >= 2 else ""
        has_why = prev.startswith("//") or "//" in lines[lineno - 1]
        why += has_why
        f = []
        rhs_norm = rhs.strip()
        if WEAK_RHS.match(rhs_norm) or WEAK_LHS.search(lhs) or (rhs_norm in ('"ok"', "'ok'") ): f.append("M4-weak")
        if rhs_norm.count("\n") >= 8 or GEN.search(lhs): f.append("M1-snapshot")
        if ZOD.search(rhs_norm) and (rhs_norm.startswith('"') or rhs_norm.startswith("'") or rhs_norm.startswith("`") or rhs_norm.startswith("[")): f.append("M2-wording")
        if len(rhs_norm) > 40 and not re.fullmatch(r"[\w.]+", rhs_norm):
            rhs_index[rhs_norm].add(path)
        for name in f: flags[name] += 1
        checks_out.write(json.dumps({"file": path, "line": lineno, "lhs": lhs[:200], "rhs": rhs_norm[:300], "why": has_why, "flags": f}) + "\n")
    in_test = [a for _, _, a in tests]
    body = src
    rows.append({
        "file": path, "lines": len(lines), "tests": len(tests), "checks": nchecks,
        "tests_with_comment": tests_with_comment, "checks_with_why": why,
        "k1_signal": bool(K1_WORD.search(header)) or bool(K1_WORD.search(" ".join(l for l in lines if l.strip().startswith("//")))),
        "k2_path": bool(BOUNDARY.search(path)),
        "flake_risk": bool(FLAKE.search(body)),
        "m4_weak": flags["M4-weak"], "m1_snapshot": flags["M1-snapshot"], "m2_wording": flags["M2-wording"],
        "median_s": round(dur_med.get(path.split("/", 1)[1] if path.startswith("beebox/") else path, 0), 1),
    })
checks_out.close()

# M3: byte-identical expected literals across files
shared = {k: sorted(v) for k, v in rhs_index.items() if len(v) > 1}
m3_files = defaultdict(int)
for k, v in shared.items():
    for p in v: m3_files[p] += 1
for r in rows: r["m3_shared_rhs"] = m3_files.get(r["file"], 0)
json.dump({k[:120]: v for k, v in shared.items()}, open(os.path.join(OUT, "shared_rhs.json"), "w"), indent=1)

with open(os.path.join(OUT, "files.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

tot = lambda k: sum(r[k] for r in rows)
print(f"files {len(rows)} tests {tot('tests')} checks {tot('checks')}")
print(f"checks with why-comment {tot('checks_with_why')} ({tot('checks_with_why')/tot('checks'):.0%}); tests with lead comment {tot('tests_with_comment')/max(1,tot('tests')):.0%}")
for k in ("m4_weak", "m1_snapshot", "m2_wording"):
    print(f"{k}: {tot(k)} checks in {sum(1 for r in rows if r[k])} files")
print(f"m3 shared literals: {len(shared)} literals across {len(m3_files)} files")
print(f"k1_signal files {sum(r['k1_signal'] for r in rows)}; k2_path files {sum(r['k2_path'] for r in rows)}; flake_risk files {sum(r['flake_risk'] for r in rows)}")
print(f"files with ledger duration {sum(1 for r in rows if r['median_s'])}")
