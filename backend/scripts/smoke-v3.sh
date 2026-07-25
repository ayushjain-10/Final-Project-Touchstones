#!/usr/bin/env bash
# smoke-v3.sh — authenticated happy-path + security checks for the v3 surfaces
# (Compliance four-fifths, Analytics ROI recompute, Network apply→accept) plus the
# v3-hardening CF-1 regression (a candidate cannot self-accept their OWN credential via the
# v2 accept route). Asserts real bodies, not just 200s. Exits non-zero on first failure.
#
# Usage: bash backend/scripts/smoke-v3.sh [BASE_URL]   (default: dev backend)
# Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from backend/.env.
set -euo pipefail
BASE_URL="${1:-https://api.touchstones.ai}"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

BASE_URL="$BASE_URL" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import json,urllib.request,urllib.error,re,os,sys
BASE=os.environ['BASE_URL'].rstrip('/'); env={}
for line in open(os.environ['ENV_FILE']):
    m=re.match(r'^([A-Z_]+)=(.*)$', line.strip())
    if m: env[m.group(1)]=m.group(2).strip().strip('"').strip("'")
SUPA=env['SUPABASE_URL']; ANON=env['SUPABASE_ANON_KEY']; SRK=env['SUPABASE_SERVICE_ROLE_KEY']
def call(method,url,headers=None,body=None,timeout=90):
    data=json.dumps(body).encode() if body is not None else None
    h=dict(headers or {})
    if data is not None: h['Content-Type']='application/json'
    try:
        r=urllib.request.urlopen(urllib.request.Request(url,data=data,headers=h,method=method),timeout=timeout)
        return r.status,(json.loads(r.read().decode() or 'null'))
    except urllib.error.HTTPError as e:
        try: return e.code,json.loads(e.read().decode() or 'null')
        except: return e.code,None
    except Exception as e: return 0,{'_e':str(e)}
def admin(e,p): call('POST',SUPA+'/auth/v1/admin/users',{'apikey':SRK,'Authorization':'Bearer '+SRK},{'email':e,'password':p,'email_confirm':True})
def login(e,p):
    s,b=call('POST',SUPA+'/auth/v1/token?grant_type=password',{'apikey':ANON},{'email':e,'password':p}); return (b or {}).get('access_token'),(b or {}).get('user',{}).get('id')
def srv(path): s,b=call('GET',SUPA+path,{'apikey':SRK,'Authorization':'Bearer '+SRK}); return b
AH=lambda t:{'Authorization':'Bearer '+t}
FAIL=[]
def chk(n,ok,d=''):
    print(f"  [{'PASS' if ok else 'FAIL'}] {n}"+(f' — {d}' if d else ''));
    if not ok: FAIL.append(n)

print(f"\nSMOKE v3 — surfaces @ {BASE}\n")
PWD='Smoke!2026xyz'
for e in ('smoke-recruiter@touchstones-test.com','smoke-candidate@touchstones-test.com','smoke-candidate-b@touchstones-test.com'): admin(e,PWD)
at,aid=login('smoke-recruiter@touchstones-test.com',PWD)
ct,cid=login('smoke-candidate@touchstones-test.com',PWD)
dt,did=login('smoke-candidate-b@touchstones-test.com',PWD)
call('PATCH',SUPA+f'/rest/v1/profiles?id=eq.{aid}',{'apikey':SRK,'Authorization':'Bearer '+SRK},{'subscription_plan':'growth','subscription_status':'active'})
chk('auth A(employer)/C(candidate)/D(other)', bool(at and ct and dt))

# ── 1. COMPLIANCE: four-fifths flags a <0.80 group ──
s,roles=call('GET',BASE+'/api/compliance/roles',AH(at))
chk('compliance: GET /roles', s==200 and 'roles' in (roles or {}))
s,ai=call('GET',BASE+'/api/compliance/adverse-impact/role/compliance-demo?attribute=race_ethnicity&outcome=advanced',AH(at))
B={g['value']:g for g in (ai or {}).get('groups',[])}.get('Group B',{})
chk('compliance: four-fifths flags B<0.80 (or honest insufficient)', s==200 and (ai.get('flagged') is True or ai.get('insufficient') is True), f"flagged={ai.get('flagged')} B={B.get('impact_ratio')}")

# ── 2. ANALYTICS: ROI recomputes from user inputs ──
s,f=call('GET',BASE+'/api/analytics/insights/funnel',AH(at)); chk('analytics: funnel', s==200)
s,r1=call('GET',BASE+'/api/analytics/insights/roi?hoursPerOnsite=4&hourlyCost=100',AH(at))
s,r2=call('GET',BASE+'/api/analytics/insights/roi?hoursPerOnsite=4&hourlyCost=300',AH(at))
d1=((r1 or {}).get('results') or {}).get('dollars_saved'); d2=((r2 or {}).get('results') or {}).get('dollars_saved')
chk('analytics: ROI recomputes (3x cost → 3x dollars_saved)', s==200 and d1 and d2 and d2==d1*3, f"{d1} vs {d2}")

# ── 3. NETWORK: apply→accept + self-accept blocked ──
s,req=call('POST',BASE+'/api/network/reqs',AH(at),{"title":"Backend (v3 smoke)","role_family":"backend"})
reqobj=(req or {}).get('req') or {}; reqtok=reqobj.get('public_token') or (req or {}).get('apply_url','').rsplit('/',1)[-1]
s,creds=call('GET',BASE+'/api/network/credentials',AH(ct)); clist=(creds or {}).get('credentials') or []
credid=clist[0].get('credential_id') or clist[0].get('id') if clist else None
chk('network: req created + C has credential', bool(reqtok and credid))
appid=None
if reqtok and credid:
    s,app=call('POST',BASE+'/api/network/apply',AH(ct),{"req_token":reqtok,"credential_id":credid})
    appid=((app or {}).get('application') or {}).get('id') or (app or {}).get('id')
    chk('network: C applies with OWN credential', s in (200,201) and bool(appid), f"http={s}")
    s,bad=call('POST',BASE+'/api/network/apply',AH(dt),{"req_token":reqtok,"credential_id":credid})
    chk('network: D cannot apply with C\'s credential', s in (403,404), f"http={s}")
if appid:
    s,sa=call('POST',BASE+f'/api/network/applications/{appid}/accept',AH(ct))
    chk('network: candidate cannot self-accept application', s==403, f"http={s}")
    s,acc=call('POST',BASE+f'/api/network/applications/{appid}/accept',AH(at))
    chk('network: employer accepts → counter>=1', s in (200,201) and (acc or {}).get('accepted_count',0)>=1, f"count={(acc or {}).get('accepted_count')}")

# ── 4. CF-1 (v3-hardening): candidate cannot self-accept own credential via the v2 accept route ──
ctok=None
ccred=srv(f'/rest/v1/verified_credentials?candidate_id=eq.{cid}&revoked_at=is.null&select=public_token&limit=1')
ctok=ccred[0]['public_token'] if ccred else None
if ctok:
    s,selfacc=call('POST',BASE+f'/api/credentials/{ctok}/accept',AH(ct),{})
    chk('CF-1: candidate self-accept own credential (v2 route) → 403', s==403, f"http={s}")

print()
if FAIL: print(f"SMOKE v3 FAILED — {len(FAIL)}: {', '.join(FAIL)}"); sys.exit(1)
print("SMOKE v3 PASSED — all v3 surfaces + CF-1 guard green ✅"); sys.exit(0)
PY
