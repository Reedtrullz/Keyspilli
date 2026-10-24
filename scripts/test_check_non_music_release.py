import unittest,importlib.util,subprocess,tempfile,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('nm_release',Path(__file__).with_name('check-non-music-release.py'))
nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(nm)

class PathTests(unittest.TestCase):
 def test_login_and_ui_files_pass(self):
  paths=['apps/web/src/auth.ts','apps/web/src/proxy.ts','apps/web/src/lib/authz.ts','apps/web/src/lib/api-auth.test.ts','apps/web/src/app/signin/page.tsx','apps/web/src/app/api/auth/[...nextauth]/route.ts','apps/web/src/components/SiteHeader.tsx','apps/web/e2e/login.spec.ts','apps/web/playwright.config.ts','docs/ops.md']
  self.assertEqual(nm.violations(paths),[])

 def test_music_catalog_and_ingestion_code_blocks(self):
  paths=['apps/web/src/components/player/Player.tsx','apps/web/src/components/player/usePlayerTransport.ts','packages/midi/src/validate.ts','packages/catalog/src/db.ts','packages/player-core/src/engine.ts','packages/engrave/src/verovio.ts','services/transcribe/src/worker.ts','catalog/manifest.json','data/db.sqlite','apps/web/src/app/api/songs/route.ts','apps/web/src/app/api/uploads/route.ts','apps/web/src/app/api/catalog/review/route.ts','apps/web/src/lib/catalog-api.ts','apps/web/src/lib/song-update.ts','apps/web/public/seed.mid','x/score.musicxml','x/score.mxl']
  self.assertEqual(nm.violations(paths),paths)

 def test_unknown_paths_fail_closed(self):
  paths=['apps/web/next.config.ts','apps/web/src/lib/something-new.ts','Dockerfile','apps/web/src/instrumentation.ts']
  self.assertEqual(nm.violations(paths),paths)

 def test_packaging_paths_pass_including_under_packages_and_services(self):
  paths=['package.json','package-lock.json','pnpm-lock.yaml','pnpm-workspace.yaml','apps/web/package.json','apps/web/Dockerfile','packages/catalog/package.json','packages/midi/package.json','services/transcribe/package.json','services/transcribe/Dockerfile','services/transcribe/Dockerfile.tutorial','services/transcribe/Dockerfile.tutorial.dockerignore','apps/web/scripts/prepare-catalog-chords.mts','apps/web/src/lib/prepare-workflow-pins.ts','apps/web/src/lib/symbolic-review-input.ts','services/transcribe/scripts/evaluate-tutorial-pipeline.ts','plugins/keyspilli/source-members.json','README.md','CONTRIBUTING.md','SECURITY.md']
  self.assertEqual(nm.violations(paths),[])

 def test_packages_and_services_source_still_blocks(self):
  paths=['packages/midi/src/validate.ts','services/transcribe/src/worker.ts','services/transcribe/scripts/other.ts']
  self.assertEqual(nm.violations(paths),paths)

 def test_blocked_beats_allowed(self):
  paths=['apps/web/src/app/api/auth/../songs/route.ts','apps/web/e2e/fixtures/seed.mid']
  self.assertEqual(nm.violations(paths),paths)

class GitTests(unittest.TestCase):
 def setUp(self):
  self.dir=tempfile.TemporaryDirectory();self.old=os.getcwd();os.chdir(self.dir.name)
  self.git('init','-q');self.git('config','user.email','t@t');self.git('config','user.name','t')
 def tearDown(self):os.chdir(self.old);self.dir.cleanup()
 def git(self,*a):return subprocess.run(['git',*a],check=True,capture_output=True,text=True).stdout.strip()
 def commit(self,path,text):
  p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);self.git('add','-A');self.git('commit','-qm',path);return self.git('rev-parse','HEAD')

 def test_pin_matches_only_the_exact_change(self):
  path='apps/web/src/lib/pdf-export.ts'
  live=self.commit(path,'a\n');target=self.commit(path,'a\nb\n')
  digest=nm.change_digest(live,target,path)
  old=dict(nm.PINNED);nm.PINNED[path]=digest
  try:
   self.assertEqual(nm.violations([path],live,target),[])
   other=self.commit(path,'a\nb\nc\n')
   self.assertEqual(nm.violations([path],live,other),[path])
  finally:nm.PINNED.clear();nm.PINNED.update(old)

 def test_tooling_is_trusted_on_main_and_must_match_main_on_release_branches(self):
  ci='.github/workflows/ci.yml';other='.github/workflows/runtime-rehearsal.yml';script='scripts/check-non-music-release.py'
  live=self.commit(ci,'one\n');self.commit(other,'one\n');self.commit(script,'one\n')
  trusted=self.commit(ci,'two\n');self.commit(other,'two\n')
  self.assertEqual(nm.violations([ci,other,script,'deploy/playbook.yml']),[])
  self.git('checkout','-qb','release/x',live);drifted=self.commit(ci,'forged\n')
  self.assertEqual(nm.violations([ci],live,drifted,trusted),[ci])
  self.assertEqual(nm.violations([other],live,drifted,trusted),[other])
  self.assertEqual(nm.violations(['scripts/sub/dir.py'],live,drifted,trusted),['scripts/sub/dir.py'])

 def test_changed_paths_requires_a_live_ancestor(self):
  a=self.commit('a.txt','1');b=self.commit('a.txt','2')
  self.assertEqual(nm.changed_paths(a,b),['a.txt'])
  with self.assertRaises(SystemExit):nm.changed_paths(b,b)
  self.git('checkout','-qb','other',a);c=self.commit('b.txt','x')
  with self.assertRaises(SystemExit):nm.changed_paths(b,c)

if __name__=='__main__':unittest.main()
