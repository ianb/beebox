import os
import subprocess,json,re,random
REPO=os.environ.get("REPO", ".")
SP=os.environ.get("SCRATCH", ".")
def git(*a): return subprocess.run(["git","-C",REPO,*a],capture_output=True,text=True).stdout
mech=json.load(open(f"{SP}/out/mechanical.json"))
IS_TEST=lambda p: p.endswith(".test.ts") or p.endswith(".doctest.md")
def is_src(p):
    if IS_TEST(p) or not p.endswith((".ts",".tsx",".js",".mjs",".swift",".css",".html",".sh")): return False
    return not any(x in ("test","tests","fixtures") for x in p.split("/"))
def rows_for(*grep):
    rows=[];cur=None;fl=[]
    def flush():
        if cur and cur not in mech: rows.append((any(IS_TEST(p) for p in fl),any(is_src(p) for p in fl)))
    for line in git("log","--no-merges",*grep,"--format=COMMIT %H","--name-only").splitlines():
        if line.startswith("COMMIT "): flush(); cur=line.split()[1]; fl=[]
        elif line.strip(): fl.append(line.strip())
    flush(); return rows
def report(label,rows):
    n=len(rows); st=sum(1 for t,s in rows if t and s); sonly=sum(1 for t,s in rows if s and not t); tonly=sum(1 for t,s in rows if t and not s)
    print(f"{label}: n={n}; src+test {st} ({100*st/n:.0f}%); src-only {sonly} ({100*sonly/n:.0f}%); test-only {tonly} ({100*tonly/n:.0f}%); neither {n-st-sonly-tonly}")
report("word-boundary fix/bug/regression (non-mech)",rows_for("-i","-E","--grep=(^|[^a-z])(fix|fixes|fixed|regression|bug)([^a-z]|$)"))
report("subject starts fix",rows_for("-E","--grep=^(fix|Fix)[(: ]"))
report("ALL non-mech commits",rows_for())
cands=[];cur=None
for line in git("log","--no-merges","--format=COMMIT %H","--name-status","--","*.test.ts","*.doctest.md").splitlines():
    if line.startswith("COMMIT "):
        cur=line.split()[1]
        if cur in mech: cur=None
    elif cur and line.startswith("M\t"): cands.append(cur); cur=None
cands=list(dict.fromkeys(cands))
CHK=re.compile(r"(t\.(check|checkText|equal|same|match|ok|notOk|strictSame|has|hasStrict|throws|rejects)\(|^[-+ ]\s*=>\s)")
def has_hunk(h):
    d=git("show","--format=","-U4",h,"--","*.test.ts","*.doctest.md")
    hk=None
    def ok(hk): return bool(hk and any(x.startswith("-") for x in hk) and any(x.startswith("+") for x in hk) and any(CHK.search(x) for x in hk))
    for l in d.splitlines():
        if l.startswith("@@"):
            if ok(hk): return True
            hk=[]
        elif hk is not None and not l.startswith(("diff ","index ","--- ","+++ ")): hk.append(l)
    return ok(hk)
random.seed(5); s=random.sample(cands,200)
hits=sum(has_hunk(h) for h in s)
print(f"of {len(cands)} non-mech commits modifying an existing test, sampled 200: {hits} ({100*hits/200:.0f}%) have a changed-assertion hunk")
