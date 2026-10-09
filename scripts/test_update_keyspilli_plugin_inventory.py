import hashlib, importlib.util, json, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('update_inventory', Path(__file__).with_name('update-keyspilli-plugin-inventory.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='keyspilli-inventory-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'README.md').write_text('fixture')
        (self.root / 'source-members.json').write_text(json.dumps({'members': ['README.md', 'source-members.json'], 'sha256': {'README.md': '0' * 64}}))

    def test_stale_check_is_read_only_and_update_is_idempotent(self):
        before = (self.root / 'source-members.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'altered'):
            module.refresh(self.root, False)
        self.assertEqual(before, (self.root / 'source-members.json').read_bytes())
        module.refresh(self.root, True)
        once = (self.root / 'source-members.json').read_bytes()
        module.refresh(self.root, True)
        self.assertEqual(once, (self.root / 'source-members.json').read_bytes())
        self.assertEqual(module.refresh(self.root, False)['status'], 'verified')

    def test_update_does_not_bless_extra_private_or_symlink_members(self):
        (self.root / 'secret.wav').write_bytes(b'private')
        with self.assertRaises(ValueError): module.refresh(self.root, True)
        (self.root / 'secret.wav').unlink()
        (self.root / 'README.md').unlink()
        (self.root / 'README.md').symlink_to('/etc/hosts')
        with self.assertRaises(ValueError): module.refresh(self.root, True)

    def test_missing_and_traversal_refuse(self):
        (self.root / 'README.md').unlink()
        with self.assertRaises(ValueError): module.refresh(self.root, True)
        (self.root / 'source-members.json').write_text(json.dumps({'members':['../private','source-members.json'],'sha256':{}}))
        with self.assertRaises(ValueError): module.refresh(self.root, True)

if __name__ == '__main__': unittest.main()
