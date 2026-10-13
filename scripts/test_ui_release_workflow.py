#!/usr/bin/env python3
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/ci.yml'


class UiReleaseWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        program = 'require "yaml"; require "json"; puts JSON.generate(YAML.load_file(ARGV[0]))'
        cls.raw = json.loads(subprocess.check_output(['ruby', '-e', program, str(WORKFLOW)], text=True))
        cls.dispatch = cls.raw.get('on', cls.raw.get('true'))['workflow_dispatch']
        cls.jobs = cls.raw['jobs']

    def test_flag_is_boolean_default_false(self):
        value = self.dispatch['inputs']['ui_only_release']
        self.assertEqual(value['type'], 'boolean')
        self.assertIs(value['default'], False)

    def test_no_input_can_name_the_live_revision(self):
        self.assertEqual(sorted(self.dispatch['inputs']), sorted(['operation', 'promote_reviewed', 'ui_only_release', 'rebuild_confirmation', 'rebuild_base_id', 'rebuild_transcription_mode']))

    def test_readiness_runs_only_after_full_checks_on_main_dispatch(self):
        condition = self.jobs['ui-release-readiness']['if']
        for part in ("github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'", 'inputs.ui_only_release == true',
                     'inputs.promote_reviewed == false', "inputs.operation == 'deploy_only'", "needs.checks.result == 'success'"):
            with self.subTest(part=part):
                self.assertIn(part, condition)
        self.assertEqual(self.jobs['ui-release-readiness']['needs'], 'checks')

    def test_readiness_derives_live_revision_from_production_not_input(self):
        steps = self.jobs['ui-release-readiness']['steps']
        self.assertEqual(steps[0]['with']['fetch-depth'], 0)
        command = chr(10).join(step.get('run', '') for step in steps)
        self.assertIn('scripts/check-ui-release.py', command)
        self.assertNotIn('--live', command)
        self.assertNotIn('inputs.', command)

    def test_publication_requires_exactly_one_gate(self):
        for name in ('build-and-push', 'deploy'):
            condition = self.jobs[name]['if']
            with self.subTest(job=name):
                self.assertIn('always()', condition)
                self.assertIn("github.event_name == 'workflow_dispatch'", condition)
                self.assertIn("github.ref == 'refs/heads/main'", condition)
                self.assertIn("inputs.operation == 'deploy_only'", condition)
                music, ui = condition.rsplit('||', 1)
                for part in ('inputs.promote_reviewed == true', 'inputs.ui_only_release == false', "needs.checks.result == 'skipped'", "needs.release-readiness.result == 'success'"):
                    self.assertIn(part, music)
                for part in ('inputs.ui_only_release == true', 'inputs.promote_reviewed == false', "needs.checks.result == 'success'", "needs.ui-release-readiness.result == 'success'"):
                    self.assertIn(part, ui)
                self.assertNotIn('release-readiness.result', ui.replace('ui-release-readiness.result', ''))
        self.assertIn('inputs.ui_only_release == false', self.jobs['release-readiness']['if'])

    def test_release_refs_are_allowed_only_for_the_ui_only_gate(self):
        clause = "startsWith(github.ref, 'refs/heads/release/') && inputs.ui_only_release == true && inputs.promote_reviewed == false"
        for name in ('ui-release-readiness', 'build-and-push', 'deploy'):
            with self.subTest(job=name):
                self.assertIn(clause, ' '.join(self.jobs[name]['if'].split()))
        for name, job in self.jobs.items():
            if name not in ('ui-release-readiness', 'build-and-push', 'deploy'):
                with self.subTest(job=name):
                    self.assertNotIn('release/', str(job.get('if', '')))
        self.assertIn("github.ref == 'refs/heads/main'", self.jobs['release-readiness']['if'])

    def test_release_refs_must_ship_main_tooling(self):
        command = chr(10).join(step.get('run', '') for step in self.jobs['ui-release-readiness']['steps'])
        self.assertIn('--tooling-ref origin/main', command)
        main_line = [line for line in command.split(chr(10)) if '--target' in line and '--tooling-ref' not in line]
        self.assertEqual(len(main_line), 1)

    def test_both_jobs_depend_on_the_new_gate(self):
        self.assertIn('ui-release-readiness', self.jobs['build-and-push']['needs'])
        self.assertIn('ui-release-readiness', self.jobs['deploy']['needs'])
        self.assertIn('build-and-push', self.jobs['deploy']['needs'])

    def test_deploy_still_targets_production_and_verifies_version(self):
        deploy = self.jobs['deploy']
        self.assertEqual(deploy['environment']['name'], 'production')
        self.assertIn('Verify public deployment version', [step.get('name') for step in deploy['steps']])


if __name__ == '__main__':
    unittest.main()
