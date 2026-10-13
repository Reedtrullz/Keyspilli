#!/usr/bin/env python3
"""Fail closed before a UI-only promotion: the diff since the live revision, not a reviewer, proves no music or data code ships."""
import argparse,base64,json,os,re,subprocess,sys,urllib.request

HEALTH_URL='https://keys.reidar.tech/api/health'
BLOCKED=re.compile(r'(^|/)(route|middleware|instrumentation)\.[jt]sx?$')
ALLOWED=[re.compile(p) for p in (
 r'apps/web/src/components/(?!player/).+',
 r'apps/web/src/app/(?!api/).+',
 r'apps/web/e2e/.+',
 r'docs/.+',
 r'.+\.test\.[jt]sx?',
)]

def violations(paths):
 return [p for p in paths if BLOCKED.search(p) or not any(r.fullmatch(p) for r in ALLOWED)]

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
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--live');p.add_argument('--target',required=True);a=p.parse_args()
 live=a.live or live_revision()
 for sha in (live,a.target):
  if not re.fullmatch('[a-f0-9]{40}',sha):sys.exit(f'not a full commit SHA: {sha!r}')
 paths=changed_paths(live,a.target)
 bad=violations(paths)
 if bad:sys.exit('not UI-only; blocked paths:\n'+'\n'.join(bad[:50])+(f'\n... and {len(bad)-50} more' if len(bad)>50 else ''))
 print(f'UI-only: {len(paths)} files changed since live {live[:12]}, all inside the allowlist')

if __name__=='__main__':main()
