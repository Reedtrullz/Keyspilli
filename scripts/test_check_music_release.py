"""Promotion boundaries: manifest decisions, no provider/production access."""
import unittest,importlib.util,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('music_release',Path(__file__).with_name('check-music-release.py'))
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
SHA='a'*40

def fixture():
 return {'schemaVersion':1,'kind':'keyspilli-music-release','commit':SHA,'operation':'deploy_only','runtimeScope':'isolated-candidate-rehearsal','gates':{name:{'status':'passed','receiptSha256':'b'*64,'reviewedCommit':SHA} for name in ('source','structural','musical','runtime')},'requiredChecks':[{'name':'Automatic checks','id':1,'headSha':SHA}]}

def checkrun(**changes):
 return {'name':'Automatic checks','id':1,'head_sha':SHA,'status':'completed','conclusion':'success','app':{'slug':'github-actions'},**changes}

class ReleaseTests(unittest.TestCase):
 def check(self,value,checks=None):return release.validate_manifest(value,SHA,checks if checks is not None else [checkrun()])
 def test_missing_musical_gate_blocks_production(self):
  value=fixture();value['gates']['musical']['status']='pending'
  with self.assertRaisesRegex(ValueError,'musical'):self.check(value)
 def test_missing_failed_or_pending_gate_blocks_production(self):
  for status in ('failed','pending'):
   value=fixture();value['gates']['source']['status']=status
   with self.subTest(status=status),self.assertRaisesRegex(ValueError,'source'):self.check(value)
  value=fixture();del value['gates']['structural']
  with self.assertRaisesRegex(ValueError,'all four'):self.check(value)
 def test_previous_head_or_cancelled_checks_cannot_pass(self):
  for change in [{'head_sha':'c'*40},{'conclusion':'cancelled'},{'status':'in_progress'},{'id':2},{'app':{'slug':'foreign'}}]:
   with self.subTest(change=change),self.assertRaises(ValueError):self.check(fixture(),[checkrun(**change)])
 def test_foreign_release_revision_and_reingest_refuse(self):
  for change in [{'commit':'c'*40},{'operation':'rebuild_all'}]:
   with self.assertRaises(ValueError):self.check({**fixture(),**change})
 def test_missing_or_skipped_restore_receipt_refuses(self):
  value=fixture();value['gates']['runtime']['receiptSha256']=None
  with self.assertRaises(ValueError):self.check(value)
 def test_complete_exact_reviewed_revision_passes(self):self.assertTrue(self.check(fixture()))
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
