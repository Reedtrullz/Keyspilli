#!/usr/bin/env python3
"""Structural promotion graph checks for the Keyspilli GitHub workflow."""
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/ci.yml'


class MusicPromotionWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        program = 'require "yaml"; require "json"; puts JSON.generate(YAML.load_file(ARGV[0]))'
        cls.raw = json.loads(subprocess.check_output(['ruby', '-e', program, str(WORKFLOW)], text=True))
        cls.dispatch = cls.raw.get('on', cls.raw.get('true'))['workflow_dispatch']
        cls.jobs = cls.raw['jobs']

    def test_promote_reviewed_is_boolean_default_false(self):
        value = self.dispatch['inputs']['promote_reviewed']
        self.assertEqual(value['type'], 'boolean')
        self.assertIs(value['default'], False)

    def test_promotion_skips_checks_with_distinct_prerequisite_name(self):
        job = self.jobs['checks']
        self.assertIn('Promotion prerequisites', job['name'])
        self.assertIn('Automatic checks', job['name'])
        self.assertIn('inputs.promote_reviewed', job['name'])
        self.assertIn('inputs.promote_reviewed', job['if'])

    def test_ordinary_events_never_reach_publication(self):
        for name in ('release-readiness', 'build-and-push', 'deploy'):
            condition = self.jobs[name]['if']
            with self.subTest(job=name):
                self.assertIn("github.event_name == 'workflow_dispatch'", condition)
                self.assertIn('inputs.promote_reviewed == true', condition)

    def test_promotion_requires_main_deploy_only_and_intended_skipped_result(self):
        for name in ('release-readiness', 'build-and-push', 'deploy'):
            condition = self.jobs[name]['if']
            with self.subTest(job=name):
                self.assertIn("github.ref == 'refs/heads/main'", condition)
                self.assertIn('inputs.operation == ', condition)
                self.assertIn("needs.checks.result == 'skipped'", condition)
        self.assertIn("inputs.operation == 'deploy_only'", self.jobs['release-readiness']['if'])

    def test_readiness_failure_blocks_build_and_deploy(self):
        for name in ('build-and-push', 'deploy'):
            condition = self.jobs[name]['if']
            with self.subTest(job=name):
                self.assertIn('always()', condition)
                self.assertIn("needs.release-readiness.result == 'success'", condition)

    def test_check_runs_are_read_through_all_pages(self):
        steps = self.jobs['release-readiness']['steps']
        command = '\n'.join(step.get('run', '') for step in steps)
        self.assertIn('--paginate', command)
        self.assertIn('jq -s', command)
        self.assertIn('per_page=100', command)

    def test_images_and_app_version_use_full_sha(self):
        steps = self.jobs['build-and-push']['steps']
        image_step = next(step for step in steps if step.get('id') == 'image')
        self.assertIn('echo "tag=${GITHUB_SHA}"', image_step['run'])
        self.assertNotIn('${GITHUB_SHA::12}', image_step['run'])
        deploy = self.jobs['deploy']
        deploy_step = next(step for step in deploy['steps'] if step.get('name') == 'Deploy immutable image tags')
        self.assertEqual(deploy_step['env']['APP_VERSION'], '${{ github.sha }}')


if __name__ == '__main__':
    unittest.main()
