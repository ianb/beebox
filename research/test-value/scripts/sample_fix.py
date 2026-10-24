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
cands=[];cur=None;fl=[]
def flush():
    if cur and cur not in mech and any(IS_TEST(p) for p in fl) and any(is_src(p) for p in fl): cands.append(cur)
for line in git("log","--no-merges","-i","-E","--grep=fix|regression|bug","--format=COMMIT %H","--name-only").splitlines():
    if line.startswith("COMMIT "): flush(); cur=line.split()[1]; fl=[]
    elif line.strip(): fl.append(line.strip())
flush()
print("fix-ish non-mech commits touching src+test:",len(cands))
allfix=git("log","--no-merges","-i","-E","--grep=fix|regression|bug","--format=%H").split()
print("all fix-ish non-merge commits:",len(allfix))
rf=[h for h in allfix if re.match(r"review fix",git("log","-1","--format=%s",h),re.I)]
print("of which subject starts 'Review fix':",len(rf))
random.seed(11); random.shuffle(cands)
with open(f"{SP}/out/sample_fix.txt","w") as f:
    for h in cands[:30]:
        msg=git("log","-1","--format=%h %ad %s%n%b","--date=short",h)
        msg=re.sub(r"\n(Co-Authored-By|Claude-Session|Workstream|Plan|Track|Issue):.*","",msg)
        f.write(f"\n\n######## {msg.strip()}\n")
        f.write(git("show","--format=","--stat",h).strip()+"\n")
        d=git("show","--format=","-U0",h,"--","*.test.ts","*.doctest.md")
        added=[l for l in d.splitlines() if l.startswith("+") and not l.startswith("+++") and re.search(r'void test\(|^\+#+ |^\+test\(|t\.test\(',l)]
        f.write("ADDED TEST HEADINGS/NAMES:\n"+"\n".join(added[:12])+"\n")
        pl=sum(1 for l in d.splitlines() if l.startswith("+") and not l.startswith("+++")); ml=sum(1 for l in d.splitlines() if l.startswith("-") and not l.startswith("---"))
        f.write(f"test diff +{pl} -{ml}\n")
json.dump(cands[:30],open(f"{SP}/out/sample_fix_hashes.json","w"))
