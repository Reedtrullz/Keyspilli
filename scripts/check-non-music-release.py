#!/usr/bin/env python3
"""Fail closed before a non-music deploy: the diff since the live revision must stay out of music, catalog, player and ingestion code.

This is an allowlist. A path that is not listed below blocks the release, so new
music or catalog code is refused by default. Package-manager and image packaging
paths (lockfiles, workspace manifests, Dockerfiles) are allowlisted separately so
a pnpm/npm migration can use the non-music gate. It does not replace the reviewed
music-release manifest, which remains the only route for music changes.
"""
import argparse,base64,hashlib,json,os,re,subprocess,sys,urllib.request

HEALTH_URL='https://keys.reidar.tech/api/health'
USER_AGENT='keyspilli-release-check/1.0'

# Always blocked, even if a later rule would allow them.
# packages/ and services/ source stays blocked; packaging manifests are handled by
# PACKAGING below so a package-manager migration can ship without a music review.
BLOCKED=re.compile(
 r'^(packages|services)/.+\.(ts|tsx|js|jsx|mjs|cjs|py|wasm)$'
 r'|^catalog/'
 r'|^data/'
 r'|^seed-midi/'
 r'|(^|/)components/player/'
 r'|^apps/web/src/app/api/(?!auth/)'
 r'|\.(mid|midi|musicxml|mxl)$'
 r'|(^|/)manifest\.json$'
 r'|(^|/)\.\.(/|$)')

# Package-manager / image packaging only. Evaluated before BLOCKED so root and
# workspace manifests under packages/ and services/ are not hard-refused.
PACKAGING=re.compile(
 r'^package\.json$'
 r'|^package-lock\.json$'
 r'|^pnpm-lock\.yaml$'
 r'|^pnpm-workspace\.yaml$'
 r'|^npm-shrinkwrap\.json$'
 r'|^apps/web/package\.json$'
 r'|^apps/web/Dockerfile$'
 r'|^packages/[^/]+/package\.json$'
 r'|^services/[^/]+/package\.json$'
 r'|^services/[^/]+/Dockerfile[^/]*$'
 r'|^services/[^/]+/.*\.dockerignore$'
 r'|^apps/web/scripts/prepare-catalog-chords\.mts$'
 r'|^apps/web/src/lib/prepare-workflow-pins\.ts$'
 r'|^apps/web/src/lib/symbolic-review-input\.ts$'
 r'|^services/[^/]+/scripts/evaluate-tutorial-pipeline\.ts$'
 r'|^plugins/keyspilli/.+'
 r'|^(README|CONTRIBUTING|SECURITY)\.md$')

ALLOWED=[re.compile(p) for p in (
 r'apps/web/src/components/(?!player/).+',
 r'apps/web/src/app/(?!api/).+',
 r'apps/web/src/app/api/auth/.+',
 r'apps/web/src/(auth\.ts|auth-types\.d\.ts|proxy\.ts)',
 r'apps/web/src/lib/(authz|access-store|api-auth|mutation-auth)(\.test)?\.ts',
 r'apps/web/playwright[^/]*\.ts',
 r'apps/web/e2e/.+',
 r'docs/.+',
 r'evidence/.+',
 r'.+\.test\.[jt]sx?',
)]

# Release machinery: allowed when the target is main itself (reviewed through its PR);
# on a release branch it must equal the trusted ref exactly. All workflow files are
# tooling so a package-manager CI swap must match origin/main on release/*.
TOOLING=re.compile(r'\.github/workflows/.+|scripts/[^/]+|deploy/.+')

# Exact reviewed exceptions: sha256 of the added and removed lines since the live revision.
PINNED={
 # GitHub login release: one added dependency, its lockfile entries, and two added auth headers.
 'apps/web/package.json':'5ce61e75e2931aa1c2b70ed3cd4172ba90674a3e66fbf9d0dc8480caa6228dd6',
 'package-lock.json':'6b56c8c04956558dbe158e3bdee13e05bb742c23f8a04f190104ef51478ce68f',
 'apps/web/src/lib/pdf-export.ts':'ef10a56434945d5f82fd157188d9666e9822546a6e9d3c6bfcf1ac4f8545de33',
 'apps/web/scripts/verify-native-player.mts':'d13e790b764d9ab1e7163fff4b17a7bcb0b456a18df3eb76b7abb290c443b270',
}

def change_digest(live,target,path):
 out=subprocess.run(['git','diff','-U0','--no-color','--no-renames',live,target,'--',path],check=True,capture_output=True,text=True).stdout
 lines=[l for l in out.split('\n') if l.startswith(('+','-')) and not l.startswith(('+++ ','--- '))]
 return hashlib.sha256(('\n'.join(lines)+'\n').encode()).hexdigest()

def pinned_ok(path,live,target):
 return bool(live and target and path in PINNED and change_digest(live,target,path)==PINNED[path])

def tooling_ok(path,target,ref):
 if not TOOLING.fullmatch(path):return False
 if ref is None:return True
 return bool(target and subprocess.run(['git','diff','--quiet','--no-renames',ref,target,'--',path]).returncode==0)

def packaging_ok(path):
 return bool(PACKAGING.fullmatch(path))

def violations(paths,live=None,target=None,tooling_ref=None):
 return [p for p in paths if not packaging_ok(p) and (BLOCKED.search(p) or (not any(r.fullmatch(p) for r in ALLOWED) and not pinned_ok(p,live,target) and not tooling_ok(p,target,tooling_ref)))]

def live_revision():
 headers={'Accept':'application/json','User-Agent':USER_AGENT}
 # Edge Basic Auth only while enabled (the app reads Authorization before the token header).
 if os.environ.get('KEYSPILLI_ACCESS_USERNAME') and os.environ.get('KEYSPILLI_ACCESS_PASSWORD'):
  credentials=f"{os.environ['KEYSPILLI_ACCESS_USERNAME']}:{os.environ['KEYSPILLI_ACCESS_PASSWORD']}".encode()
  headers['Authorization']='Basic '+base64.b64encode(credentials).decode()
 if os.environ.get('KEYSPILLI_API_TOKEN'):headers['X-Keyspilli-Api-Token']='Bearer '+os.environ['KEYSPILLI_API_TOKEN']
 request=urllib.request.Request(HEALTH_URL,headers=headers)
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
 if bad:sys.exit('touches music, catalog or unreviewed paths; use the reviewed music release instead. Blocked paths:\n'+'\n'.join(bad[:50])+(f'\n... and {len(bad)-50} more' if len(bad)>50 else ''))
 print(f'Non-music release accepted: {len(paths)} changed paths since {live[:12]}, none in music, catalog or unreviewed code')

if __name__=='__main__':main()
