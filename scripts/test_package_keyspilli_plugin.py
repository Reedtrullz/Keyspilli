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
if __name__=='__main__':unittest.main()
