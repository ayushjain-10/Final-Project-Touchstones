#!/usr/bin/env bash
# smoke-core-loop.sh — end-to-end smoke test of the core recruiter↔candidate loop.
#
# Drives: auth → author → assign → candidate GET → ai-assist → integrity events →
#         ai-interactions → submit → run (code exec) → score → GET score (+overall_explanation)
#         → audit.json → score-direction → credential issue → public verify.
# Asserts each step and exits non-zero on the first failure; prints PASS at the end.
#
# Usage:
#   bash backend/scripts/smoke-core-loop.sh [BASE_URL]
#     BASE_URL defaults to the dev backend. Examples:
#       bash backend/scripts/smoke-core-loop.sh                                  # dev backend
#       bash backend/scripts/smoke-core-loop.sh http://localhost:3097            # local server
#       bash backend/scripts/smoke-core-loop.sh https://touchstone-api-dev.onrender.com
#
# Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from backend/.env.
# Test users are admin-created with email_confirm=true (self-signup requires email
# confirmation on this project — see product-plan/mvp-contract.md).
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
        r=urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h,method=method),timeout=60)
        return r.status, json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or '{}')
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'_err':str(e)}

FAILED=[]
def check(name, ok, detail=''):
    mark='PASS' if ok else 'FAIL'
    print(f"  [{mark}] {name}" + (f" — {detail}" if detail else ""))
    if not ok: FAILED.append(name)

def admin(email,pw): call('POST',SUPA+'/auth/v1/admin/users',{'apikey':SRK,'Authorization':'Bearer '+SRK},{'email':email,'password':pw,'email_confirm':True})
def setplan(uid,plan): call('PATCH',SUPA+f'/rest/v1/profiles?id=eq.{uid}',{'apikey':SRK,'Authorization':'Bearer '+SRK},{'subscription_plan':plan,'subscription_status':'active'})
def login(email,pw):
    s,b=call('POST',SUPA+'/auth/v1/token?grant_type=password',{'apikey':ANON},{'email':email,'password':pw}); return b.get('access_token'),b.get('user',{}).get('id')
def AH(t): return {'Authorization':'Bearer '+t}

print(f"\nSMOKE — core loop @ {BASE}\n")
REC="smoke-recruiter@touchstones-test.com"; CAND="smoke-candidate@touchstones-test.com"; PW="Smoke!2026xyz"
admin(REC,PW); admin(CAND,PW)
rt,rid=login(REC,PW); ct,cid=login(CAND,PW)
setplan(rid,'growth')  # avoid the free 5-screen cap across repeated smoke runs
check("auth: recruiter + candidate sessions", bool(rt and ct and rid and cid), f"rid={rid}")

s,ws=call('POST',BASE+'/api/proof/work-samples',AH(rt),{
  "title":"[smoke] add(a,b)","prompt_md":"Implement add(a,b) returning the sum; export from solution.js.",
  "response_type":"code","languages":["javascript"],
  "starter_files":[{"path":"solution.js","content":"module.exports=(a,b)=>{}\n"}],
  "tests":{"command":"node -e \"const a=require('./solution.js'); if(a(2,3)!==5) process.exit(1); console.log('ok')\""},
  "rubric":{"criteria":[{"id":"correctness","requirement":"add returns the sum","points_possible":60,"weight":1},
                        {"id":"quality","requirement":"clean + exported","points_possible":40,"weight":1}]}})
wsid=ws.get('id'); check("author work-sample", s==201 and bool(wsid), f"id={wsid}")

s,sub=call('POST',BASE+f'/api/proof/work-samples/{wsid}/assign',AH(rt),{"candidate_id":cid})
subid=sub.get('id'); check("assign → submission", s==201 and bool(subid), f"status={sub.get('status')}")
if not subid:
    print("\nABORT: cannot continue without a submission"); sys.exit(1)

s,g=call('GET',BASE+f'/api/proof/submissions/{subid}',AH(ct))
check("candidate GET submission", s==200 and bool(g.get('work_sample')), f"ws={(g.get('work_sample') or {}).get('title')}")

s,a=call('POST',BASE+f'/api/proof/submissions/{subid}/ai-assist',AH(ct),{"message":"How do I implement and export add(a,b)?"})
check("ai-assist (LLM reply)", s==200 and len(str(a.get('reply','')))>0, f"reply_len={len(str(a.get('reply','')))}")

s,ie=call('POST',BASE+'/api/integrity/events',AH(ct),{"submission_id":subid,"events":[
   {"type":"session_submit","category":"behavior","meta":{"typed_chars":120,"paste_chars":6,"final_chars":126},"client_ts":"2026-06-25T10:05:00Z"}]})
check("integrity events", s==201 and ie.get('accepted',0)>=1 and bool(ie.get('head_hash')))

s,ai=call('POST',BASE+f'/api/proof/submissions/{subid}/ai-interactions',AH(ct),{"events":[
   {"role":"user","content":"how to add"},{"role":"assistant","content":"return a+b","disposition":"accepted"}]})
# Endpoint intentionally removed (migrations 095/096; proof.js returns 410 Gone) — assert the tombstone.
check("ai-interactions (410 tombstone)", s==410)

s,sb=call('POST',BASE+f'/api/proof/submissions/{subid}/submit',AH(ct),{"response_code":"module.exports = (a,b) => a + b;\n"})
check("submit", s==200 and sb.get('status')=='submitted')

s,rn=call('POST',BASE+f'/api/proof/submissions/{subid}/run',AH(ct),{})
# Pass if code-exec ran (E2B configured) OR degraded cleanly (no E2B / no tests) — both 200-ish.
ran_ok = (s==200 and (rn.get('ran') is True or rn.get('ran') is False)) or (s==503 and rn.get('available') is False)
check("run hidden tests (or graceful degrade)", ran_ok, f"http={s} available={rn.get('available')} ran={rn.get('ran')} passed={rn.get('passed')}")

s,dg=call('GET',BASE+f'/api/integrity/submissions/{subid}/digest',AH(rt))
check("integrity digest verified_chain:true", s==200 and dg.get('verified_chain') is True)

s,sc=call('POST',BASE+f'/api/proof/submissions/{subid}/score',AH(rt),{})
scid=sc.get('scoreId') or sc.get('id')
check("score (0–100 + outcome)", s==200 and isinstance(sc.get('normalized_score'),(int,float)) and bool(scid),
      f"score={sc.get('normalized_score')} outcome={sc.get('outcome')}")

# Re-score MUST be idempotent (no 500): returns 200 with the same score row.
s2,sc2=call('POST',BASE+f'/api/proof/submissions/{subid}/score',AH(rt),{})
scid2=sc2.get('scoreId') or sc2.get('id')
check("re-score is idempotent (200, same score id)", s2==200 and bool(scid2) and scid2==scid,
      f"http={s2} same_id={scid2==scid} cached={sc2.get('cached')}")

if scid:
    s,gs=call('GET',BASE+f'/api/proof/scores/{scid}',AH(rt))
    check("GET score: reasoning + evidence persisted",
          s==200 and bool(gs.get('overall_explanation')) and len(gs.get('per_criterion') or [])>=1,
          f"overall_explanation={'yes' if gs.get('overall_explanation') else 'NO'} per_criterion={len(gs.get('per_criterion') or [])}")
    s,au=call('GET',BASE+f'/api/proof/scores/{scid}/audit.json',AH(rt))
    check("audit.json immutable record (row_hash)", s==200 and bool(au.get('row_hash')))

s,dir=call('POST',BASE+f'/api/proof/submissions/{subid}/score-direction',AH(rt),{})
check("score-direction", s==200 and isinstance(dir.get('direction_score'),(int,float)), f"direction={dir.get('direction_score')}")

s,cr=call('POST',BASE+f'/api/credentials/submissions/{subid}/issue',AH(rt),{})
tok=cr.get('public_token'); check("credential issue", s in (200,201) and bool(tok))
if tok:
    s,vf=call('GET',BASE+f'/api/credentials/verify/{tok}',None)
    check("public credential verify", s==200 and vf.get('valid') is True, f"score={vf.get('score')}")

print()
if FAILED:
    print(f"SMOKE FAILED — {len(FAILED)} step(s): {', '.join(FAILED)}"); sys.exit(1)
print("SMOKE PASSED — full core loop is green ✅"); sys.exit(0)
PY
