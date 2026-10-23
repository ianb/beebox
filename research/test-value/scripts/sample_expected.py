import os
import subprocess,json,re,random,sys
REPO=os.environ.get("REPO", ".")
SP=os.environ.get("SCRATCH", ".")
def git(*a): return subprocess.run(["git","-C",REPO,*a],capture_output=True,text=True).stdout
mech=json.load(open(f"{SP}/out/mechanical.json"))
# commits that Modified an existing test file
cands=[]
cur=None
for line in git("log","--no-merges","--format=COMMIT %H %ad","--date=short","--name-status","--","*.test.ts","*.doctest.md").splitlines():
    if line.startswith("COMMIT "):
        cur=line.split()[1]; 
        if cur in mech: cur=None
    elif cur and line.startswith("M\t"):
        cands.append(cur); cur=None
cands=list(dict.fromkeys(cands))
print("non-mech commits modifying an existing test:",len(cands))
CHK=re.compile(r"(t\.(check|checkText|equal|same|match|ok|notOk|strictSame|has|hasStrict|throws|rejects)\(|^[-+ ]\s*=>\s)")
def hunks(h):
    out=[]
    d=git("show","--format=","-U4",h,"--","*.test.ts","*.doctest.md")
    fn=None; hk=[]
    def flush():
        if hk:
            body=hk
            minus=[l for l in body if l.startswith("-")]; plus=[l for l in body if l.startswith("+")]
            if minus and plus and any(CHK.search(l) for l in body):
                out.append((fn,"\n".join(body)))
    for l in d.splitlines():
        if l.startswith("diff --git"):
            flush(); hk=[]; fn=l.split(" b/")[-1]
        elif l.startswith("@@"):
            flush(); hk=[l]
        elif hk is not None and not l.startswith(("index ","--- ","+++ ")):
            hk.append(l)
    flush()
    return out
random.seed(7)
random.shuffle(cands)
picked=[]
for h in cands:
    hs=hunks(h)
    if hs: picked.append((h,hs))
    if len(picked)>=40: break
print("scanned until 40 found")
with open(f"{SP}/out/sample_expected.txt","w") as f:
    for h,hs in picked:
        msg=git("log","-1","--format=%h %ad %s%n%b","--date=short",h)
        msg=re.sub(r"\n(Co-Authored-By|Claude-Session|Workstream|Plan|Track|Issue):.*","",msg)
        stat=git("show","--format=","--stat",h).strip().splitlines()[-1]
        f.write(f"\n\n######## {msg.strip()}\n[{stat}]\n")
        for fn,b in hs[:3]:
            f.write(f"--- {fn}\n{b[:2500]}\n")
json.dump([h for h,_ in picked],open(f"{SP}/out/sample_expected_hashes.json","w"))
