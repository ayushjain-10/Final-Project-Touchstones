#!/usr/bin/env bash
# smoke-v2.sh — authenticated happy-path smoke for the v2 surfaces, run as ONE cross-feature
# flow (Section 2c): mini core-loop → screen-gen → live-probe → calibration → passport →
# accept-prior, plus a LIVE regression check of the S4-1 P0 fix (cross-tenant credential graft
# must be rejected by RLS). Asserts real bodies, not just 200s. Exits non-zero on first failure.
#
# Usage: bash backend/scripts/smoke-v2.sh [BASE_URL]   (default: dev backend)
# Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from backend/.env.
set -euo pipefail
BASE_URL="${1:-https://api.touchstones.ai}"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

BASE_URL="$BASE_URL" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import json,urllib.request,urllib.error,re,os,sys
BASE=os.environ['BASE_URL'].rstrip('/')
env={}
for line in open(os.environ['ENV_FILE']):
    m=re.match(r'^([A-Z_]+)=(.*)$', line.strip())
    if m: env[m.group(1)]=m.group(2).strip().strip('"').strip("'")
SUPA=env['SUPABASE_URL']; ANON=env['SUPABASE_ANON_KEY']; SRK=env['SUPABASE_SERVICE_ROLE_KEY']

def call(method,url,headers=None,body=None):
    data=json.dumps(body).encode() if body is not None else None
    h=dict(headers or {})
    if data is not None: h['Content-Type']='application/json'
    try:
        r=urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h,method=method),timeout=120)
        return r.status, json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or '{}')
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'_err':str(e)}

FAILED=[]
def check(name, ok, detail=''):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    if not ok: FAILED.append(name)

def admin(email,pw): call('POST',SUPA+'/auth/v1/admin/users',{'apikey':SRK,'Authorization':'Bearer '+SRK},{'email':email,'password':pw,'email_confirm':True})
def setplan(uid,plan): call('PATCH',SUPA+f'/rest/v1/profiles?id=eq.{uid}',{'apikey':SRK,'Authorization':'Bearer '+SRK},{'subscription_plan':plan,'subscription_status':'active'})
def login(email,pw):
    s,b=call('POST',SUPA+'/auth/v1/token?grant_type=password',{'apikey':ANON},{'email':email,'password':pw}); return b.get('access_token'),b.get('user',{}).get('id')
def AH(t): return {'Authorization':'Bearer '+t}

print(f"\nSMOKE v2 — new surfaces @ {BASE}\n")
REC="smoke-recruiter@touchstones-test.com"; CA="smoke-candidate@touchstones-test.com"; CB="smoke-candidate-b@touchstones-test.com"; PW="Smoke!2026xyz"
for e in (REC,CA,CB): admin(e,PW)
rt,rid=login(REC,PW); cat,caid=login(CA,PW); cbt,cbid=login(CB,PW)
setplan(rid,'growth')
check("auth: recruiter + 2 candidates", bool(rt and cat and cbt), f"rid={rid}")

# ── mini core loop → a SCORED submission + an issued credential for candidate A ──
s,ws=call('POST',BASE+'/api/proof/work-samples',AH(rt),{
  "title":"[smoke-v2] add(a,b)","prompt_md":"Implement add(a,b); export from solution.js.","response_type":"code","languages":["javascript"],
  "starter_files":[{"path":"solution.js","content":"module.exports=(a,b)=>{}\n"}],
  "tests":{"command":"node -e \"const a=require('./solution.js'); if(a(2,3)!==5) process.exit(1)\""},
  "rubric":{"criteria":[{"id":"correctness","requirement":"sum","points_possible":60,"weight":1},{"id":"quality","requirement":"clean","points_possible":40,"weight":1}]}})
wsid=ws.get('id')
s,sub=call('POST',BASE+f'/api/proof/work-samples/{wsid}/assign',AH(rt),{"candidate_id":caid}); subid=sub.get('id')
call('POST',BASE+f'/api/proof/submissions/{subid}/submit',AH(cat),{"response_code":"module.exports = (a,b) => a + b;\n"})
s,sc=call('POST',BASE+f'/api/proof/submissions/{subid}/score',AH(rt),{}); scid=sc.get('scoreId') or sc.get('id')
s,cr=call('POST',BASE+f'/api/credentials/submissions/{subid}/issue',AH(rt),{}); tok=cr.get('public_token'); credid=cr.get('id')
check("setup: scored submission + issued credential", bool(subid and scid and tok and credid), f"score={sc.get('normalized_score')}")

# ── 1. SCREEN-GEN (Author with AI): rubric must normalize to sum 100 ──
s,g=call('POST',BASE+'/api/screen-gen/from-jd',AH(rt),{"jd":"Senior backend engineer: fix a billing rounding bug, owns reliability.","language":"javascript"})
draft=g.get('draft') or {}
rsum=sum(int(r.get('points',0)) for r in (draft.get('rubric') or []))
check("screen-gen from-jd → draft with rubric summing to 100", s==200 and bool(draft.get('task') or draft.get('task_markdown')) and rsum==100, f"http={s} rubric_sum={rsum}")

# ── 2. LIVE PROBE: start (recruiter) returns a grounded question; public token view leaks NO score ──
s,p=call('POST',BASE+f'/api/interview/submissions/{subid}/probe/start',AH(rt),{})
ptok=p.get('token'); q=p.get('question')
check("probe start → adaptive question", s in (200,201) and bool(q) and len(str(q))>5, f"http={s} q_len={len(str(q or ''))}")
if ptok:
    s,cv=call('GET',BASE+f'/api/interview/probe/by-token/{ptok}',None)
    leaks = any(k in cv for k in ('probe_score','dimensions','reasoning','account_id','submission_id'))
    check("probe public token view is candidate-safe (no score/internal ids)", s==200 and bool(cv.get('question')) and not leaks, f"keys={sorted(cv.keys())}")

# ── 3. CALIBRATION / BENCHMARKS: a scored result carries a calibration object (insufficient_data honest) ──
s,cal=call('GET',BASE+f'/api/benchmarks/score/{scid}',AH(rt))
calob = cal.get('calibration') or cal
ok_cal = s==200 and ('scope' in calob or 'insufficient_data' in calob or 'percentile' in calob)
check("benchmarks /score/:id → calibration object", ok_cal, f"http={s} scope={calob.get('scope')} insufficient={calob.get('insufficient_data')}")

# ── 4. PASSPORT: candidate A claims a handle, adds THEIR credential, public read shows it ──
HANDLE="smoke-cand-a"
s,pp=call('POST',BASE+'/api/passport',AH(cat),{"handle":HANDLE,"display_name":"Smoke A"})
if s==409:
    s,pp=call('GET',BASE+'/api/passport',AH(cat)); ppid=(pp.get('passport') or {}).get('id')
else:
    ppid=(pp.get('passport') or {}).get('id')
check("passport claim/exists", bool(ppid), f"handle={HANDLE}")
s,en=call('POST',BASE+'/api/passport/entries',AH(cat),{"token":tok})
check("passport add own credential (RLS-allowed)", s in (201,409), f"http={s}")
s,pub=call('GET',BASE+f'/api/passport/{HANDLE}',None)
entries=pub.get('entries') or []
check("public passport shows the verified entry (score present, no PII)", s==200 and len(entries)>=1 and entries[0].get('score') is not None and 'candidate_id' not in entries[0], f"entries={len(entries)}")

# ── 5. ACCEPT-PRIOR: recruiter accepts the credential; counter ≥ 1; idempotent on re-accept ──
s,ac=call('POST',BASE+f'/api/credentials/{tok}/accept',AH(rt),{"req_label":"Backend req"})
n1=ac.get('accepted_count')
s,ac2=call('POST',BASE+f'/api/credentials/{tok}/accept',AH(rt),{"req_label":"Backend req"})
n2=ac2.get('accepted_count')
check("accept-prior → counter ≥1 and idempotent (no double-count)", s in (200,201) and (n1 or 0)>=1 and n1==n2, f"count={n1} reaccept={n2}")

# ── 6. S4-1 P0 LIVE REGRESSION: candidate B cannot graft candidate A's credential ──
# Direct PostgREST insert with B's JWT, pointing at A's credential_id — RLS must REJECT.
s,bpp=call('POST',BASE+'/api/passport',AH(cbt),{"handle":"smoke-cand-b","display_name":"Smoke B"})
if s==409:
    s,bpp=call('GET',BASE+'/api/passport',AH(cbt)); bppid=(bpp.get('passport') or {}).get('id')
else:
    bppid=(bpp.get('passport') or {}).get('id')
s,graft=call('POST',SUPA+'/rest/v1/passport_entries',
    {'apikey':ANON,'Authorization':'Bearer '+cbt,'Prefer':'return=representation'},
    {'passport_id':bppid,'credential_id':credid})
# A correct fix returns an RLS error (401/403/4xx), NOT a created row.
grafted = s in (200,201) and isinstance(graft,list) and len(graft)>0
check("S4-1 P0: cross-tenant credential graft is REJECTED by RLS", bppid is not None and not grafted, f"http={s} grafted={grafted}")

# ── 7. S4-3: verify RECOMPUTES the audit chain → chain_consistent:true (untampered) ──
s,vf=call('GET',BASE+f'/api/credentials/{tok}/verify',None)
check("S4-3: credential verify recomputes chain → chain_consistent:true", s==200 and vf.get('chain_consistent') is True, f"chain_consistent={vf.get('chain_consistent')}")

# ── 8. S4-2 + S4-1b: trust signals are SERVER-AUTHORITATIVE on the public passport ──
# This run's submission emitted NO behavioral events → proof_of_human must be 'review'
# (fail-closed, S4-2), never a candidate-forgeable 'verified'.
s,pub2=call('GET',BASE+f'/api/passport/{HANDLE}',None)
mine=[e for e in (pub2.get('entries') or []) if e.get('token')==tok]
poh = mine[0].get('proof_of_human') if mine else None
check("S4-2: zero-event submission → proof_of_human 'review' (server-computed, fail-closed)", poh=='review', f"proof_of_human={poh}")

# S4-1b: a direct PostgREST insert that tries to FORGE the trust columns must be rejected —
# authenticated has no column privilege for proof_of_human / percentile / title.
s,forge=call('POST',SUPA+'/rest/v1/passport_entries',
    {'apikey':ANON,'Authorization':'Bearer '+cat,'Prefer':'return=representation'},
    {'passport_id':ppid,'credential_id':credid,'proof_of_human':'verified','percentile':99,'title':'Staff Engineer'})
forged = s in (200,201) and isinstance(forge,list) and len(forge)>0
check("S4-1b: direct forge of trust columns (proof_of_human/percentile/title) is REJECTED", not forged, f"http={s} forged={forged}")

# ── 9. S1-1: two CONCURRENT answers on one probe token → exactly one wins, the other 409 ──
import concurrent.futures
if ptok:
    def _answer(_):
        return call('POST',BASE+f'/api/interview/probe/by-token/{ptok}/answer',None,
                    {"answer":"My reasoning about the core decision and the tradeoffs I weighed."})[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        codes=list(ex.map(_answer,[1,2]))
    oks=sum(1 for c in codes if c in (200,201)); conflicts=sum(1 for c in codes if c==409)
    check("S1-1: concurrent answers serialized (exactly one wins, the other 409)", oks==1 and conflicts==1, f"codes={codes}")

print()
if FAILED:
    print(f"SMOKE v2 FAILED — {len(FAILED)} step(s): {', '.join(FAILED)}"); sys.exit(1)
print("SMOKE v2 PASSED — all new surfaces green ✅"); sys.exit(0)
PY
