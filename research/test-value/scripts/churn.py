import subprocess, sys, csv, re, json, os, datetime
from concurrent.futures import ThreadPoolExecutor
REPO=os.environ.get("REPO", ".")
SP=os.environ.get("SCRATCH", ".")
TODAY=datetime.date(2026,10,22)
def git(*a):
    return subprocess.run(["git","-C",REPO,*a],capture_output=True,text=True,check=True).stdout

# 1. commit metadata
meta={}
raw=git("log","--no-merges","--format=%H%x00%ad%x00%s%x00%B%x1e","--date=short")
for rec in raw.split("\x1e"):
    rec=rec.strip("\n")
    if not rec: continue
    h,d,s,b=rec.split("\x00",3)
    meta[h]={"date":d,"subject":s,"body":b}
# 2. commit file lists
files={}
cur=None
for line in git("log","--no-merges","--format=COMMIT %H","--name-only").splitlines():
    if line.startswith("COMMIT "): cur=line[7:]; files[cur]=[]
    elif line.strip(): files[cur].append(line.strip())
IS_TEST=lambda p: p.endswith(".test.ts") or p.endswith(".doctest.md")
CODE_EXT=(".ts",".tsx",".js",".mjs",".cjs",".jsx",".css",".html",".sh",".py",".swift",".yaml",".yml",".toml",".json")
def is_src(p):
    if IS_TEST(p): return False
    if not p.endswith(CODE_EXT): return False
    parts=p.split("/")
    if any(x in ("test","tests","fixtures","__fixtures__","golden") for x in parts): return False
    return True
for h in files:
    fl=files[h]
    meta[h]["ntest"]=sum(IS_TEST(p) for p in fl)
    meta[h]["nsrc"]=sum(is_src(p) for p in fl)
    meta[h]["nfiles"]=len(fl)
# 3. mechanical set
MECH_PAT=re.compile(r"^(Test cleanup|Typecheck doctests|Strengthen test checks|Layout moves|Convert .*doctests|Convert the remaining|Drop doctest leftovers|Purge the word \"doctest\"|Rename agent-doctest|Remove the doctest format|Rewrite pre-move path mentions|Rename dev-repo CLAUDE\.md|Retire stale CLAUDE\.md|Typecheck two tests through|Point browse and workstreams-app tap|test\(doctest\): (declare|group))")
mech={}
for h,m in meta.items():
    why=None
    if m["ntest"]>50: why=">50 test files"
    elif MECH_PAT.match(m["subject"]): why="sweep subject"
    if why: mech[h]=why
json.dump({h:{"why":w,"date":meta[h]["date"],"ntest":meta[h]["ntest"],"subject":meta[h]["subject"]} for h,w in mech.items()},open(f"{SP}/out/mechanical.json","w"),indent=1)
CONVERT=set(h for h,m in meta.items() if m["date"]=="2026-10-18" and re.match(r"Convert .*\(track 4\)|Typecheck two tests through",m["subject"]))
FIXRE=re.compile(r"\b(fix|fixes|fixed|bug|regression|issue)\b",re.I)
PINRE=re.compile(r"\b(regression|bug|fix(es|ed)?)\b",re.I)

def history(path):
    """list of (hash, status) oldest-last order from git log --follow, bridged across doctest conversion"""
    out=[]
    cur=path; rev=None
    for _ in range(3):
        args=["log","--no-merges","--follow","--format=%H","--name-status"]
        if rev: args.append(rev)
        args+=["--",cur]
        txt=git(*args)
        h=None
        for line in txt.splitlines():
            if not line.strip(): continue
            if re.fullmatch(r"[0-9a-f]{40}",line): h=line
            else:
                st=line.split("\t")[0][0]
                out.append((h,st))
        if not out: break
        lasth,lastst=out[-1]
        if lastst=="A" and lasth in CONVERT and cur.endswith(".test.ts"):
            doc=cur[:-len(".test.ts")]+".doctest.md"
            try: git("cat-file","-e",f"{lasth}^:{doc}")
            except subprocess.CalledProcessError: break
            cur=doc; rev=lasth+"^"; continue
        break
    return out

tests=[l.strip().lstrip("./") for l in open(f"{SP}/all-tests.txt") if l.strip()]
with ThreadPoolExecutor(8) as ex:
    hists=list(ex.map(history,tests))

rows=[]
for path,h in zip(tests,hists):
    if not h: rows.append({"path":path,"error":"nohist"}); continue
    cre,_=h[-1]
    m=meta.get(cre,{})
    later=[x for x,st in h[:-1]]
    later_nm=[x for x in later if x not in mech]
    later_mech=[x for x in later if x in mech]
    base=os.path.basename(path).split(".")[0]
    def touches_subject(x):
        return any(is_src(f) and os.path.basename(f).split(".")[0]==base for f in files[x])
    subj=[x for x in later_nm if touches_subject(x)]
    cs=[x for x in later_nm if meta[x]["nsrc"]>0]
    to=[x for x in later_nm if meta[x]["nsrc"]==0]
    try: lines=sum(1 for _ in open(os.path.join(REPO,path),encoding="utf-8",errors="replace"))
    except Exception: lines=-1
    cd=datetime.date.fromisoformat(m["date"])
    rows.append({
        "path":path,"created":m["date"],"create_hash":cre[:9],"create_subject":m["subject"][:100],
        "create_mechanical": "Y" if cre in mech else "",
        "cocreated_with_code":"Y" if m["nsrc"]>0 else "",
        "create_nsrc":m["nsrc"],"create_nfiles":m["nfiles"],"create_ntest":m["ntest"],
        "create_touches_subject":"Y" if touches_subject(cre) else "",
        "later_touches_subject":len(subj),
        "later_small_code_and_test":sum(1 for x in cs if meta[x]["nfiles"]<=6),
        "create_mentions_fix":"Y" if PINRE.search(m["subject"]+"\n"+m["body"]) else "",
        "bridged_from_doctest":"Y" if any(st=="A" and x in CONVERT for x,st in h) and h[-1][0] not in CONVERT else "",
        "later_commits_all":len(later),"later_mechanical":len(later_mech),"later_nonmech":len(later_nm),
        "later_code_and_test":len(cs),"later_test_only":len(to),
        "age_days":(TODAY-cd).days,"lines":lines,
        "later_nonmech_hashes":" ".join(x[:9] for x in later_nm),
    })
cols=list(rows[0].keys())
with open(f"{SP}/out/churn.csv","w",newline="") as f:
    w=csv.DictWriter(f,fieldnames=cols,extrasaction="ignore"); w.writeheader(); w.writerows(rows)
import statistics
good=[r for r in rows if "error" not in r]
N=len(good)
def pct(k): return f"{k} ({100*k/N:.1f}%)"
print("tests:",N,"errors:",len(rows)-N)
print("mechanical commits:",len(mech))
print("never changed since creation (excluding mechanical):",pct(sum(1 for r in good if r["later_nonmech"]==0)))
print("never changed at all (incl mechanical):",pct(sum(1 for r in good if r["later_commits_all"]==0)))
print("created in a mechanical commit:",pct(sum(1 for r in good if r["create_mechanical"])))
print("bridged across doctest conversion:",pct(sum(1 for r in good if r["bridged_from_doctest"])))
print("co-created with code:",pct(sum(1 for r in good if r["cocreated_with_code"])))
print("creation commit mentions fix/bug/regression:",pct(sum(1 for r in good if r["create_mentions_fix"])))
print("co-created AND mentions fix:",pct(sum(1 for r in good if r["create_mentions_fix"] and r["cocreated_with_code"])))
print("creation commit touches a src file with the same basename:",pct(sum(1 for r in good if r["create_touches_subject"])))
print(">=1 later commit touching same-basename src file:",pct(sum(1 for r in good if r["later_touches_subject"]>0)))
print(">=1 later SMALL (<=6 files) code-and-test commit:",pct(sum(1 for r in good if r["later_small_code_and_test"]>0)))
print("creation commit size: median files",statistics.median(r["create_nfiles"] for r in good),"median src",statistics.median(r["create_nsrc"] for r in good),"median tests",statistics.median(r["create_ntest"] for r in good))
print("creation commit nfiles<=6:",pct(sum(1 for r in good if r["create_nfiles"]<=6)))
print(">=1 code-and-test later commit:",pct(sum(1 for r in good if r["later_code_and_test"]>0)))
print("only test-only later edits (>=1, no code-and-test):",pct(sum(1 for r in good if r["later_test_only"]>0 and r["later_code_and_test"]==0)))
print(">=1 test-only later commit:",pct(sum(1 for r in good if r["later_test_only"]>0)))
import statistics
for k in ("later_nonmech","later_code_and_test","later_test_only","later_mechanical","age_days","lines"):
    v=[r[k] for r in good]; print(k,"mean",round(statistics.mean(v),2),"median",statistics.median(v),"max",max(v))
# distribution of later_nonmech
from collections import Counter
c=Counter(min(r["later_nonmech"],10) for r in good)
print("later_nonmech histogram (10=10+):",sorted(c.items()))
c=Counter(r["created"][:7] for r in good); print("creation month:",sorted(c.items()))
# per-age bucket: change rate
for lo,hi in ((0,30),(30,90),(90,180),(180,400)):
    b=[r for r in good if lo<=r["age_days"]<hi]
    if b: print(f"age {lo}-{hi}d n={len(b)} never-changed={100*sum(1 for r in b if r['later_nonmech']==0)/len(b):.0f}% code+test>=1={100*sum(1 for r in b if r['later_code_and_test']>0)/len(b):.0f}% cocreated={100*sum(1 for r in b if r['cocreated_with_code'])/len(b):.0f}%")
