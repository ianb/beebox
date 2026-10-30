import os
import json,collections,csv,sys
LEDGER=os.environ["LEDGER"]; FILESETS=os.environ["FILESETS"]; OUT=sys.argv[1]
norm=lambda f: f[:-11]+".test.ts" if f.endswith(".doctest.md") else f
fs={}
for l in open(FILESETS):
    if l.strip(): d=json.loads(l); fs[d["hash"]]=set(norm(x) for x in d["files"])
recs=[json.loads(l) for l in open(LEDGER) if l.strip()]
full=[r for r in recs if not r.get("marker") and r.get("exitCode",0) in (0,1) and r["mode"]=="full"]
print("full by tier:",collections.Counter((r.get("source"),r.get("tier")) for r in full))
full.sort(key=lambda r:r["ts"])
# episode: consecutive observations of a file (runs that RAN it) that fail; broken by a run that ran it and passed
cur={}; ep=collections.defaultdict(list)
for r in full:
    ran=fs[r["ranFiles"]]; failing={norm(f["file"]) for f in r["failures"]}
    for f in ran:
        if f in failing:
            if f in cur: cur[f]["n"]+=1; cur[f]["end"]=r["ts"][:10]
            else: cur[f]={"start":r["ts"][:10],"end":r["ts"][:10],"n":1}
        elif f in cur: ep[f].append(cur.pop(f))
for f,c in cur.items(): ep[f].append(c|{"open":True})
rows=[(f,len(e),sum(x["n"] for x in e),max(x["n"] for x in e),";".join(f"{x['start']}..{x['end']}x{x['n']}"+("(open)" if x.get("open") else "") for x in e)) for f,e in ep.items()]
rows.sort(key=lambda t:(-t[1],-t[2]))
with open(OUT+"/full_episodes.csv","w",newline="") as fh:
    w=csv.writer(fh); w.writerow(["file","episodes","fails","longest","episode_list"]); w.writerows(rows)
alle=[x for e in ep.values() for x in e]
print("files:",len(rows),"episodes:",len(alle),"single-run episodes:",sum(1 for x in alle if x["n"]==1),"open (still red at last obs):",sum(1 for x in alle if x.get("open")))
print("episode-count dist:",sorted(collections.Counter(t[1] for t in rows).items()))
print("episode-length dist:",sorted(collections.Counter(x["n"] for x in alle).items()))
print(f"{'file':66} ep fails longest  episodes")
for t in rows[:45]: print(f"{t[0]:66} {t[1]:2} {t[2]:4} {t[3]:4}  {t[4][:150]}")
