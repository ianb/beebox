import os
import json, sys, csv, collections, statistics
LEDGER=os.environ["LEDGER"]
FILESETS=os.environ["FILESETS"]
OUT=sys.argv[1]
def norm(f):
    return f[:-len(".doctest.md")]+".test.ts" if f.endswith(".doctest.md") else f
filesets={}
for line in open(FILESETS):
    if line.strip():
        d=json.loads(line); filesets[d["hash"]]=[norm(f) for f in d["files"]]
recs=[]
raw_total=0
for line in open(LEDGER):
    if not line.strip(): continue
    raw_total+=1
    r=json.loads(line)
    r["failures"]=[{"file":norm(f["file"]),"class":f["class"]} for f in r.get("failures",[])]
    recs.append(r)
markers=[r for r in recs if r.get("marker")]
def completed(r): return r.get("exitCode",0) in (0,1)
measured=[r for r in recs if not r.get("marker") and completed(r)]
incomplete=[r for r in recs if not r.get("marker") and not completed(r)]
print(f"raw records {raw_total}; markers {len(markers)}; incomplete(exit not 0/1) {len(incomplete)}; measured {len(measured)}")
print("incomplete exit codes:", collections.Counter(r.get("exitCode") for r in incomplete))
print("measured by mode:", collections.Counter(r["mode"] for r in measured))
print("full by source:", collections.Counter((r["mode"],r.get("source")) for r in measured if r["mode"]=="full"))
print("date range:", min(r["ts"] for r in recs)[:10], "to", max(r["ts"] for r in recs)[:10])
full=[r for r in measured if r["mode"]=="full"]
sel=[r for r in measured if r["mode"]=="selected"]
print("full runs:",len(full),"selected runs:",len(sel))
print("full runs by exit:",collections.Counter(r["exitCode"] for r in full))
print("full runs by month:",sorted(collections.Counter(r["ts"][:7] for r in full).items()))
# failing-file count distribution per full run
fc=[len({f["file"] for f in r["failures"]}) for r in full]
print("failing files per full run distribution:",sorted(collections.Counter(fc).items()))
ISO_MAX=3; MASS_MIN=20  # >20 = environment per schedules/full-suite/lib.ts ENVIRONMENT_FAILURE_FILES
def bucket(n):
    if n==0: return "green"
    if n<=ISO_MAX: return "isolated"
    if n<=MASS_MIN: return "moderate"
    return "mass"
print("full run buckets:",collections.Counter(bucket(n) for n in fc))
# unknown ranFiles?
missing=[r for r in measured if r["ranFiles"] not in filesets]
print("records with unresolved ranFiles hash:",len(missing))
# deriveFlakes
def derive_flakes(records):
    flakes=collections.defaultdict(list); failed_at={}
    for i,r in enumerate(records):
        key=(r["commit"],r["treeHash"])
        ran=set(filesets.get(r["ranFiles"],[]))
        failing={f["file"] for f in r["failures"]}
        prev=failed_at.get(key,set())
        for f in list(prev):
            if f in ran and f not in failing:
                flakes[f].append(i); prev.discard(f)
        prev|=failing; failed_at[key]=prev
    return flakes
flakes_all=derive_flakes(measured)
flakes_full=derive_flakes(full)
# per-file full stats
allfiles=set()
for r in measured: allfiles|=set(filesets.get(r["ranFiles"],[]))
st=collections.defaultdict(lambda: dict(runs=0,fails=0,isolated=0,moderate=0,mass=0,fail_runs=[]))
for r in full:
    n=len({f["file"] for f in r["failures"]}); b=bucket(n)
    for f in filesets.get(r["ranFiles"],[]): st[f]["runs"]+=1
    for f in {f["file"] for f in r["failures"]}:
        st[f]["fails"]+=1; st[f][b]+=1; st[f]["fail_runs"].append(r["ts"][:10])
ever_full={f for f,s in st.items() if s["fails"]>0}
ran_full={f for f,s in st.items() if s["runs"]>0}
print("files ever run in full:",len(ran_full),"ever failed in full:",len(ever_full),"never failed:",len(ran_full-ever_full))
print("files failed in full ONLY in mass runs:",sum(1 for f in ever_full if st[f]["isolated"]==0 and st[f]["moderate"]==0))
print("files with >=1 isolated full failure:",sum(1 for f in ever_full if st[f]["isolated"]>0))
print("full failure-count distribution (files x times failed):",sorted(collections.Counter(s["fails"] for f,s in st.items() if s["fails"]>0).items()))
print("full isolated-failure distribution:",sorted(collections.Counter(s["isolated"] for f,s in st.items() if s["isolated"]>0).items()))
# flake counts restricted to full
with open(OUT+"/full_per_file.csv","w",newline="") as fh:
    w=csv.writer(fh); w.writerow(["file","full_runs","full_fails","isolated","moderate","mass","flakes_fullonly","flakes_allmodes","fail_dates"])
    for f,s in sorted(st.items(),key=lambda kv:(-kv[1]["isolated"],-kv[1]["fails"])):
        if s["fails"]==0: continue
        w.writerow([f,s["runs"],s["fails"],s["isolated"],s["moderate"],s["mass"],len(flakes_full.get(f,[])),len(flakes_all.get(f,[])),";".join(sorted(set(s["fail_runs"])))])
print("\nTOP 35 by isolated full failures:")
print(f"{'file':70} runs fails iso mod mass flkF flkA")
for f,s in sorted(st.items(),key=lambda kv:(-kv[1]["isolated"],-kv[1]["fails"]))[:35]:
    if s["fails"]==0: break
    print(f"{f:70} {s['runs']:4} {s['fails']:4} {s['isolated']:3} {s['moderate']:3} {s['mass']:4} {len(flakes_full.get(f,[])):4} {len(flakes_all.get(f,[])):4}")
# flake totals
print("\nfiles with >=1 flake (all modes):",len(flakes_all),"total flake events:",sum(len(v) for v in flakes_all.values()))
print("files with >=1 flake (full only):",len(flakes_full),"events:",sum(len(v) for v in flakes_full.values()))
print("top flakes all modes:",sorted(((len(v),f) for f,v in flakes_all.items()),reverse=True)[:25])
# full-run list
with open(OUT+"/full_runs.csv","w",newline="") as fh:
    w=csv.writer(fh); w.writerow(["ts","commit","branch","source","exitCode","nfail","bucket","files"])
    for r in full:
        ff=sorted({f["file"] for f in r["failures"]}); w.writerow([r["ts"],r["commit"][:8],r["branch"],r.get("source",""),r["exitCode"],len(ff),bucket(len(ff)),";".join(ff)])
# mass runs listing
print("\nmass/moderate full runs:")
for r in full:
    ff=sorted({f["file"] for f in r["failures"]})
    if len(ff)>ISO_MAX: print(r["ts"][:16],r["commit"][:8],r["branch"],r.get("source",""),len(ff),";".join(ff)[:200])
# selected
ss=collections.defaultdict(lambda: dict(runs=0,attached=0,unimplicated=0,unknown=0))
for r in sel:
    for f in filesets.get(r["ranFiles"],[]): ss[f]["runs"]+=1
    seen=set()
    for fl in r["failures"]:
        if fl["file"] in seen: continue
        seen.add(fl["file"]); ss[fl["file"]][fl["class"]]+=1
ever_sel={f for f,s in ss.items() if s["attached"]+s["unimplicated"]+s["unknown"]>0}
print("\nselected: files ever run",len([f for f in ss if ss[f]["runs"]>0]),"ever failed",len(ever_sel))
print("selected failure class totals:",sum(s["attached"] for s in ss.values()),"attached;",sum(s["unimplicated"] for s in ss.values()),"unimplicated;",sum(s["unknown"] for s in ss.values()),"unknown")
print("selected runs by exit:",collections.Counter(r["exitCode"] for r in sel))
print("selected failing-file counts dist:",sorted(collections.Counter(len({f['file'] for f in r['failures']}) for r in sel).items())[:15])
only_sel=ever_sel-ever_full
print("files failed in selected but never in full:",len(only_sel),"of",len(ever_sel|ever_full),"ever-failed files; of all files",len(allfiles))
print("files failed in full but never in selected:",len(ever_full-ever_sel))
print("files failed in both:",len(ever_sel&ever_full))
with open(OUT+"/selected_per_file.csv","w",newline="") as fh:
    w=csv.writer(fh); w.writerow(["file","sel_runs","attached","unimplicated","unknown","ever_failed_full"])
    for f,s in sorted(ss.items(),key=lambda kv:-(kv[1]["attached"]+kv[1]["unimplicated"])):
        if s["attached"]+s["unimplicated"]+s["unknown"]==0: continue
        w.writerow([f,s["runs"],s["attached"],s["unimplicated"],s["unknown"],f in ever_full])
print("\nTOP 25 selected by failures:")
for f,s in sorted(ss.items(),key=lambda kv:-(kv[1]["attached"]+kv[1]["unimplicated"]))[:25]:
    print(f"{f:70} runs {s['runs']:4} att {s['attached']:3} unimp {s['unimplicated']:3} fullfail {st[f]['fails'] if f in st else 0}")
# files total
print("\ntotal distinct files ever in any fileset:",len(allfiles))
# which files only ever fail as flakes in full: fails>0 and flakes_full>=fails
