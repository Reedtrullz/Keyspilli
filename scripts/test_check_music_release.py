"""Promotion boundaries: manifest decisions, no provider/production access."""
import unittest,importlib.util,tempfile,copy,subprocess,sys,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('music_release',Path(__file__).with_name('check-music-release.py'))
assert spec is not None and spec.loader is not None
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
SHA='a'*40

def fixture() -> dict[str, object]:
 return {'schemaVersion':1,'kind':'keyspilli-music-release','commit':SHA,'operation':'deploy_only','runtimeScope':'isolated-candidate-rehearsal','gates':{name:{'status':'passed','receiptSha256':'b'*64,'reviewedCommit':SHA} for name in ('source','structural','musical','runtime')},'requiredChecks':[{'name':'Automatic checks','id':1,'headSha':SHA}]}

def checkrun(**changes):
 return {'name':'Automatic checks','id':1,'head_sha':SHA,'status':'completed','conclusion':'success','app':{'slug':'github-actions'},**changes}

def object_field(value:dict[str,object],key:str) -> dict[str,object]:
 field=value[key]
 assert isinstance(field,dict) and all(isinstance(name,str) for name in field)
 return field

def gate(value:dict[str,object],name:str) -> dict[str,object]:
 return object_field(object_field(value,'gates'),name)

def waived_fixture():
 value=fixture()
 gate(value,'musical').update(status='waived',ownerWaiver={
  'schemaVersion':1,'kind':'keyspilli-production-review-waiver',
  'repository':'Reedtrullz/Keyspilli','issue':305,'commit':SHA,
  'reviews':['musical-listening','physical-keyboard'],
  'authority':'repository-owner',
  'source':{'type':'user_message','reference':'codex://threads/owner-approval',
            'quote':'Waive musical and keyboard production reviews for305; do not deploy.'}})
 return value

class ReleaseTests(unittest.TestCase):
 def check(self,value,checks=None):return release.validate_manifest(value,SHA,checks if checks is not None else [checkrun()])
 def test_missing_musical_gate_blocks_production(self):
  value=fixture();gate(value,'musical')['status']='pending'
  with self.assertRaisesRegex(ValueError,'musical'):self.check(value)
 def test_missing_failed_or_pending_gate_blocks_production(self):
  for status in ('failed','pending'):
   value=fixture();gate(value,'source')['status']=status
   with self.subTest(status=status),self.assertRaisesRegex(ValueError,'source'):self.check(value)
  value=fixture();del object_field(value,'gates')['structural']
  with self.assertRaisesRegex(ValueError,'all four'):self.check(value)
 def test_previous_head_or_cancelled_checks_cannot_pass(self):
  for change in [{'head_sha':'c'*40},{'conclusion':'cancelled'},{'status':'in_progress'},{'id':2},{'app':{'slug':'foreign'}}]:
   with self.subTest(change=change),self.assertRaises(ValueError):self.check(fixture(),[checkrun(**change)])
 def test_foreign_release_revision_and_reingest_refuse(self):
  for change in [{'commit':'c'*40},{'operation':'rebuild_all'}]:
   with self.assertRaises(ValueError):self.check({**fixture(),**change})
 def test_missing_or_skipped_restore_receipt_refuses(self):
  value=fixture();gate(value,'runtime')['receiptSha256']=None
  with self.assertRaises(ValueError):self.check(value)
 def test_complete_exact_reviewed_revision_passes(self):self.assertTrue(self.check(fixture()))
 def test_explicit_owner_waiver_is_accepted_without_changing_it_to_passed(self):
  value=waived_fixture();before=copy.deepcopy(value)
  self.assertTrue(self.check(value));self.assertEqual(value,before)
  self.assertEqual(gate(value,'musical')['status'],'waived')
 def test_waiver_without_exact_owner_issue_commit_and_source_refuses(self):
  mutations=[
   lambda w:w.update(schemaVersion=2),
   lambda w:w.update(kind='generic-override'),
   lambda w:w.update(repository='foreign/repo'),
   lambda w:w.update(issue=306),
   lambda w:w.update(commit='c'*40),
   lambda w:w.update(authority='automated-reviewer'),
   lambda w:w.update(reviews=['musical-listening']),
   lambda w:w.update(reviews=['musical-listening','native-accessibility']),
   lambda w:w.update(reviews=['musical-listening','musical-listening']),
   lambda w:w.update(source={}),
   lambda w:object_field(w,'source').update(type='agent_summary'),
   lambda w:object_field(w,'source').update(reference=''),
   lambda w:object_field(w,'source').update(quote=' ')]
  for mutate in mutations:
   value=waived_fixture();waiver=object_field(gate(value,'musical'),'ownerWaiver');mutate(waiver)
   with self.subTest(waiver=waiver),self.assertRaises(ValueError):self.check(value)
  value=waived_fixture();del gate(value,'musical')['ownerWaiver']
  with self.assertRaises(ValueError):self.check(value)
 def test_owner_waiver_cannot_skip_technical_gates_or_latest_ci(self):
  for name in ('source','structural','runtime'):
   value=waived_fixture();gate(value,name)['status']='waived'
   with self.subTest(gate=name),self.assertRaises(ValueError):self.check(value)
  with self.assertRaises(ValueError):self.check(waived_fixture(),[checkrun(head_sha='c'*40)])
  for change in ({'id':2,'conclusion':'failure'},{'id':2,'status':'in_progress'}):
   with self.subTest(check=change),self.assertRaises(ValueError):self.check(waived_fixture(),[checkrun(),checkrun(**change)])
  for change in ({'operation':'rebuild_all'},{'runtimeScope':'production'}):
   with self.subTest(manifest=change),self.assertRaises(ValueError):self.check({**waived_fixture(),**change})
 def test_cli_names_waived_review_instead_of_claiming_it_passed(self):
  with tempfile.TemporaryDirectory() as directory:
   manifest=Path(directory)/'manifest.json';checks=Path(directory)/'checks.json'
   manifest.write_text(json.dumps(waived_fixture()));checks.write_text(json.dumps({'check_runs':[checkrun()]}))
   result=subprocess.run([sys.executable,str(Path(__file__).with_name('check-music-release.py')),'--manifest',str(manifest),'--checks',str(checks),'--commit',SHA],text=True,capture_output=True,timeout=10)
   self.assertEqual(result.returncode,0,result.stderr)
   self.assertIn('musical reviews WAIVED',result.stdout)
 def test_manifest_cannot_remove_required_checks(self):
  value=fixture();value['requiredChecks']=[]
  with self.assertRaises(ValueError):self.check(value)
 def test_previous_same_head_pass_does_not_cover_new_cancelled_attempt(self):
  with self.assertRaises(ValueError):self.check(fixture(),[checkrun(),checkrun(id=2,conclusion='cancelled')])
 def test_older_pinned_or_newer_nonpassing_check_refuses(self):
  for changes in ({'id':2},{'id':2,'status':'pending'},{'id':2,'conclusion':'skipped'}):
   with self.subTest(changes=changes),self.assertRaises(ValueError):self.check(fixture(),[checkrun(**changes)])
 def test_omitted_runtime_scope_refuses(self):
  value=fixture();del value['runtimeScope']
  with self.assertRaisesRegex(ValueError,'runtime scope'):self.check(value)
 def test_duplicate_or_oversized_json_refuses(self):
  for content in (b'{"a":1,"a":2}',b'x'*(1024*1024+1)):
   with self.subTest(size=len(content)),tempfile.NamedTemporaryFile() as handle:
    handle.write(content);handle.flush()
    with self.assertRaises(ValueError):release.bounded_json(handle.name)
if __name__=='__main__':unittest.main()
