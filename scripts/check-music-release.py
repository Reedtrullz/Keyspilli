#!/usr/bin/env python3
"""Fail closed before music-release promotion; reviewed receipts are human assertions.

CI checks are read from GitHub at the exact head. Gate receipt hashes bind the
review record; this validator does not manufacture listening or restore proof.
"""
import argparse,json,os,re
from pathlib import Path

REQUIRED_CHECKS={'Automatic checks'}
RUNTIME_SCOPE='isolated-candidate-rehearsal'

def require(condition,message):
 if not condition:raise ValueError(message)

def validate_owner_waiver(row,commit):
 waiver=row.get('ownerWaiver')
 require(isinstance(waiver,dict),'musical gate lacks exact owner waiver')
 require(type(waiver.get('schemaVersion')) is int and waiver['schemaVersion']==1 and waiver.get('kind')=='keyspilli-production-review-waiver','unsupported owner waiver')
 require(waiver.get('repository')=='Reedtrullz/Keyspilli' and waiver.get('issue')==305 and waiver.get('commit')==commit,'owner waiver issue or revision mismatch')
 require(waiver.get('authority')=='repository-owner','owner waiver authority required')
 reviews=waiver.get('reviews')
 require(isinstance(reviews,list) and len(reviews)==2 and all(isinstance(item,str) for item in reviews) and set(reviews)=={'musical-listening','physical-keyboard'},'owner waiver must name only musical-listening and physical-keyboard')
 source=waiver.get('source')
 require(isinstance(source,dict) and source.get('type')=='user_message','original owner message required')
 require(isinstance(source.get('reference'),str) and re.fullmatch(r'(?:https://|codex://)\S+',source['reference']) is not None and isinstance(source.get('quote'),str) and source['quote'].strip(),'owner waiver source reference and quote required')

def validate_manifest(value,commit,checks):
 require(isinstance(value,dict) and value.get('schemaVersion')==1 and value.get('kind')=='keyspilli-music-release','unsupported release manifest')
 require(re.fullmatch('[a-f0-9]{40}',commit) and value.get('commit')==commit,'release revision mismatch')
 require(value.get('operation')=='deploy_only','music promotion must preserve catalog: deploy_only required')
 require(value.get('runtimeScope')==RUNTIME_SCOPE,f'runtime scope must be {RUNTIME_SCOPE} before production')
 gates=value.get('gates',{})
 require(isinstance(gates,dict) and set(gates)=={'source','structural','musical','runtime'},'all four release gates required')
 for name,row in gates.items():
  require(isinstance(row,dict) and row.get('reviewedCommit')==commit and isinstance(row.get('receiptSha256'),str) and re.fullmatch('[a-f0-9]{64}',row['receiptSha256']),f'{name} gate lacks exact reviewed receipt')
  if name=='musical' and row.get('status')=='waived':
   validate_owner_waiver(row,commit)
  else:
   require(row.get('status')=='passed' and 'ownerWaiver' not in row,f'{name} gate lacks exact reviewed passing receipt')
 declared=value.get('requiredChecks',[])
 require(isinstance(declared,list) and len(declared)==len(REQUIRED_CHECKS) and {c.get('name') for c in declared}==REQUIRED_CHECKS,'required CI checks cannot be removed')
 for pin in declared:
  candidates=[c for c in checks if c.get('name')==pin['name'] and c.get('head_sha')==commit and c.get('app',{}).get('slug')=='github-actions']
  require(candidates,'missing current-head GitHub Actions check')
  actual=max(candidates,key=lambda c:c['id'])
  require(pin.get('headSha')==commit and type(pin.get('id')) is int and pin['id']==actual['id'] and actual.get('status')=='completed' and actual.get('conclusion')=='success','required check is stale, skipped, cancelled or not passing')
 return True

def bounded_json(path):
 with Path(path).open('rb') as f:raw=f.read(1024*1024+1)
 require(len(raw)<=1024*1024,'release JSON exceeds1MiB')
 def pairs(items):
  result={}
  for k,v in items:
   require(k not in result,'duplicate release JSON field');result[k]=v
  return result
 return json.loads(raw,object_pairs_hook=pairs)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest');p.add_argument('--checks',required=True);p.add_argument('--commit',required=True);a=p.parse_args()
 value=bounded_json(a.manifest) if a.manifest else json.loads(os.environ.get('KEYSPILLI_MUSIC_RELEASE_MANIFEST_JSON','{}'))
 validate_manifest(value,a.commit,bounded_json(a.checks)['check_runs'])
 if value['gates']['musical']['status']=='waived':
  print('Exact release manifest and current CI checks accepted; musical reviews WAIVED by recorded owner exception, not performed')
 else:
  print('Exact reviewed music release manifest and current CI checks passed')
if __name__=='__main__':main()
