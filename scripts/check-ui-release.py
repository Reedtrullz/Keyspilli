#!/usr/bin/env python3
"""Fail closed before a UI-only promotion: the diff since the live revision, not a reviewer, proves no music or data code ships."""
import argparse,base64,hashlib,json,os,re,subprocess,sys,urllib.request

HEALTH_URL='https://keys.reidar.tech/api/health'
BLOCKED=re.compile(r'(^|/)(route|middleware|instrumentation)\.[jt]sx?$')
ALLOWED=[re.compile(p) for p in (
 r'apps/web/src/components/(?!player/).+',
 r'apps/web/src/app/(?!api/).+',
 r'apps/web/e2e/.+',
 r'docs/.+',
 r'.+\.test\.[jt]sx?',
)]

PINNED={'apps/web/src/components/player/Player.tsx':'a74fda072e7fe17f162c53595979e9e33810ab3e3f23c0fbf3bd5bc8ca0fbba4'}

def change_digest(live,target,path):
 out=subprocess.run(['git','diff','-U0','--no-color','--no-renames',live,target,'--',path],check=True,capture_output=True,text=True).stdout
 lines=[l for l in out.split('\n') if l.startswith(('+','-')) and not l.startswith(('+++ ','--- '))]
 return hashlib.sha256(('\n'.join(lines)+'\n').encode()).hexdigest()

def pinned_ok(path,live,target):
 return bool(live and target and path in PINNED and change_digest(live,target,path)==PINNED[path])

TOOLING=re.compile(r'\.github/workflows/ci\.yml|scripts/[^/]+')

def tooling_ok(path,target,ref):
 return bool(ref and target and TOOLING.fullmatch(path) and subprocess.run(['git','diff','--quiet','--no-renames',ref,target,'--',path]).returncode==0)

def violations(paths,live=None,target=None,tooling_ref=None):
 return [p for p in paths if BLOCKED.search(p) or (not any(r.fullmatch(p) for r in ALLOWED) and not pinned_ok(p,live,target) and not tooling_ok(p,target,tooling_ref))]

def live_revision():
 credentials=f"{os.environ['KEYSPILLI_ACCESS_USERNAME']}:{os.environ['KEYSPILLI_ACCESS_PASSWORD']}".encode()
 request=urllib.request.Request(HEALTH_URL,headers={'Accept':'application/json','Authorization':'Basic '+base64.b64encode(credentials).decode()})
 with urllib.request.urlopen(request,timeout=15) as response:payload=json.loads(response.read().decode())
 if payload.get('status')!='healthy':sys.exit('production is not healthy; refusing to promote')
 return payload.get('version','')

def changed_paths(live,target):
 if live==target:sys.exit('target revision is already live')
 if subprocess.run(['git','merge-base','--is-ancestor',live,target]).returncode:sys.exit('live revision is not an ancestor of the target')
 out=subprocess.run(['git','diff','--name-only','--no-renames',live,target],check=True,capture_output=True,text=True).stdout
 return [p for p in out.split('\n') if p]

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--live');p.add_argument('--target',required=True);p.add_argument('--tooling-ref');a=p.parse_args()
 live=a.live or live_revision()
 for sha in (live,a.target):
  if not re.fullmatch('[a-f0-9]{40}',sha):sys.exit(f'not a full commit SHA: {sha!r}')
 paths=changed_paths(live,a.target)
 bad=violations(paths,live,a.target,a.tooling_ref)
 if bad:sys.exit('not UI-only; blocked paths:\n'+'\n'.join(bad[:50])+(f'\n... and {len(bad)-50} more' if len(bad)>50 else ''))
 print(f'UI-only: {len(paths)} files changed since live {live[:12]}, all inside the allowlist')

if __name__=='__main__':main()
