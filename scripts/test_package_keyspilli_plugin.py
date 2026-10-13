import importlib.util,unittest,tempfile,json,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('package_plugin',Path(__file__).with_name('package-keyspilli-plugin.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class PackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='keyspilli-package-test-');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.source=self.root/'source';self.source.mkdir();(self.source/'README.md').write_text('fixture');(self.source/'source-members.json').write_text(json.dumps({'members':['README.md','source-members.json'],'sha256':{'README.md':hashlib.sha256(b'fixture').hexdigest()}}))
    def test_reproducible_exact_members(self):
        a=module.package(self.source,self.root/'a.zip',self.root/'a.json');b=module.package(self.source,self.root/'b.zip',self.root/'b.json');self.assertEqual(a['archiveSha256'],b['archiveSha256']);self.assertEqual([r['name'] for r in a['members']],['README.md','source-members.json'])
    def test_refuses_private_or_undeclared_files(self):
        (self.source/'private.wav').write_bytes(b'private');self.assertRaises(ValueError,module.package,self.source,self.root/'a.zip',self.root/'a.json')
    def test_refuses_altered_or_missing_source(self):
        (self.source/'README.md').write_text('changed');self.assertRaises(ValueError,module.package,self.source,self.root/'a.zip',self.root/'a.json')
    def test_refuses_symlinks(self):
        (self.source/'README.md').unlink();(self.source/'README.md').symlink_to('/etc/hosts');self.assertRaises(ValueError,module.package,self.source,self.root/'a.zip',self.root/'a.json')
    def test_output_exists_refuses(self):
        module.package(self.source,self.root/'a.zip',self.root/'a.json');self.assertRaises(FileExistsError,module.package,self.source,self.root/'a.zip',self.root/'a.json')
    def test_refuses_a_release_with_a_missing_referenced_score_review(self):
        text='[Score review](skills/keyspilli-song/references/score-review-workflow.md)'
        (self.source/'README.md').write_text(text)
        inventory=json.loads((self.source/'source-members.json').read_text());inventory['sha256']['README.md']=hashlib.sha256(text.encode()).hexdigest();(self.source/'source-members.json').write_text(json.dumps(inventory))
        self.assertRaisesRegex(ValueError,'reference',module.package,self.source,self.root/'a.zip',self.root/'a.json')
    def test_checks_heading_fragments_in_packaged_references(self):
        text='# Intake and preparation\n\n[Start](README.md#intake-and-preparation)\n[Missing](#imaginary-command)\n'
        (self.source/'README.md').write_text(text)
        self.assertRaisesRegex(ValueError,'fragment',module.validate_references,self.source)
        (self.source/'README.md').write_text(text.replace('[Missing](#imaginary-command)', '[Here](#intake-and-preparation)'))
        self.assertEqual(len(module.validate_references(self.source)),2)
if __name__=='__main__':unittest.main()
