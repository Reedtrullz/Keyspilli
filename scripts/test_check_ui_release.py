import unittest,importlib.util,subprocess,tempfile,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('ui_release',Path(__file__).with_name('check-ui-release.py'))
ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)

class PathTests(unittest.TestCase):
 def test_ui_files_pass(self):
  paths=['apps/web/src/components/SongBrowser.tsx','apps/web/src/components/song-display.ts','apps/web/src/app/globals.css','apps/web/src/app/page.tsx','apps/web/e2e/app.spec.ts','docs/ops.md','packages/midi/src/x.test.ts']
  self.assertEqual(ui.violations(paths),[])
 def test_music_data_and_deploy_files_block(self):
  paths=['apps/web/src/components/player/Player.tsx','apps/web/src/components/player/chord-practice.ts','.github/workflows/ci.yml','packages/midi/src/validate.ts','packages/catalog/src/db.ts','packages/player-core/src/engine.ts','apps/web/src/lib/catalog-api.ts','apps/web/src/app/api/songs/route.ts','services/transcribe/src/x.py','deploy/playbook.yml','package-lock.json','apps/web/Dockerfile','catalog/manifest.json','apps/web/src/app/export/route.ts','apps/web/src/components/hidden/middleware.ts']
  self.assertEqual(ui.violations(paths),paths)

class GitTests(unittest.TestCase):
 def setUp(self):
  self.dir=tempfile.TemporaryDirectory();self.old=os.getcwd();os.chdir(self.dir.name)
  self.git('init','-q');self.git('config','user.email','t@t');self.git('config','user.name','t')
 def tearDown(self):os.chdir(self.old);self.dir.cleanup()
 def git(self,*a):return subprocess.run(['git',*a],check=True,capture_output=True,text=True).stdout.strip()
 def commit(self,path,text):
  Path(path).parent.mkdir(parents=True,exist_ok=True);Path(path).write_text(text);self.git('add','-A');self.git('commit','-qm',path);return self.git('rev-parse','HEAD')
 def test_ui_only_delta_passes_and_music_delta_blocks(self):
  live=self.commit('apps/web/src/components/a.tsx','1');ui_only=self.commit('apps/web/src/components/a.tsx','2');music=self.commit('packages/midi/src/a.ts','x')
  self.assertEqual(ui.changed_paths(live,ui_only),['apps/web/src/components/a.tsx'])
  self.assertEqual(ui.violations(ui.changed_paths(live,music)),['packages/midi/src/a.ts'])
 def test_target_must_descend_from_live_and_differ(self):
  live=self.commit('docs/a.md','1');self.git('checkout','-qb','other','HEAD~0');other=self.commit('docs/b.md','2');self.git('checkout','-q','-');side=self.commit('docs/c.md','3')
  with self.assertRaises(SystemExit):ui.changed_paths(other,side)
  with self.assertRaises(SystemExit):ui.changed_paths(live,live)

if __name__=='__main__':unittest.main()
