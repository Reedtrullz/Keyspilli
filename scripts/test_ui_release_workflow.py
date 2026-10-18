#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
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

    def test_rebuild_schedules_only_after_successful_main_validation(self):
        cases = []
        for operation in ('rebuild_target', 'rebuild_all'):
            cases.append({'event': 'workflow_dispatch', 'ref': 'refs/heads/main', 'operation': operation,
                          'checks': 'success', 'promote': False, 'ui': False, 'expected': True})
        for key, values in {
            'event': ('push', 'pull_request'),
            'ref': ('refs/heads/feature/test', 'refs/heads/release/test', 'refs/tags/test'),
            'operation': ('deploy_only', 'unknown'),
            'checks': ('failure', 'cancelled', 'skipped'),
            'promote': (True,), 'ui': (True,),
        }.items():
            for value in values:
                cases.append({**cases[0], key: value, 'expected': False})
        program = r'''
const assert = require('node:assert/strict'), vm = require('node:vm');
const {job, cases} = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
for (const item of cases) {
  const needs = {checks: {result: item.checks}, deploy: {result: 'skipped'}};
  const dependencies = Array.isArray(job.needs) ? job.needs : [job.needs];
  const success = () => dependencies.every(name => needs[name]?.result === 'success');
  const explicitStatus = /\b(always|success|failure|cancelled)\s*\(/.test(job.if);
  const context = {github: {event_name: item.event, ref: item.ref}, needs,
    inputs: {operation: item.operation, promote_reviewed: item.promote, ui_only_release: item.ui},
    success, always: () => true, failure: () => dependencies.some(name => needs[name]?.result === 'failure'),
    cancelled: () => dependencies.some(name => needs[name]?.result === 'cancelled')};
  const actual = (explicitStatus || success()) && vm.runInNewContext(`Boolean(${job.if})`, context, {timeout: 100});
  assert.equal(actual, item.expected, JSON.stringify(item));
}
'''
        result = subprocess.run(['node', '-e', program], input=json.dumps({
            'job': self.jobs['reingest-youtube-catalog'], 'cases': cases,
        }), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rebuild_requires_the_dispatch_revision_before_any_catalog_write(self):
        installed = '1' * 40

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if not self.headers.get('Authorization', '').startswith('Basic '):
                    self.send_response(401)
                    self.end_headers()
                    return
                body = json.dumps({'status': 'healthy', 'version': installed} if self.path == '/api/health'
                                  else {'songs': [{'id': 'fixture-a', 'baseId': 'fixture', 'tempo': 120}], 'total': 1}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: object) -> None:
                pass

        steps = self.jobs['reingest-youtube-catalog']['steps']
        first = next(index for index, step in enumerate(steps) if step['name'] == 'Configure SSH key') + 1
        mutation = next(index for index, step in enumerate(steps) if step['name'] == 'Re-ingest all sources and repair artifacts on VPS')
        with HTTPServer(('127.0.0.1', 0), Handler) as server, tempfile.TemporaryDirectory() as directory:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                bin_dir = Path(directory)
                (bin_dir / 'python3').symlink_to(sys.executable)
                ssh = bin_dir / 'ssh'
                ssh.write_text('#!/bin/sh\nprintf "write\\n" >> "$PROBE_WRITES"\nexit 77\n')
                ssh.chmod(0o700)
                for expected, may_write in ((installed, True), ('2' * 40, False)):
                    with self.subTest(expected=expected):
                        writes = bin_dir / expected
                        env = {'PATH': str(bin_dir) + os.pathsep + os.defpath,
                               'HOME': directory, 'PROBE_WRITES': str(writes),
                               'VPS_HOST': '203.0.113.10', 'VPS_USER': 'fixture'}
                        outputs = []
                        exit_code = None
                        for step in steps[first:mutation + 1]:
                            for key, value in step.get('env', {}).items():
                                env[key] = str(value).replace('${{ github.sha }}', expected).replace('${{ inputs.rebuild_base_id }}', 'fixture').replace('${{ inputs.rebuild_transcription_mode }}', 'strict')
                            env.update(KEYSPILLI_DEPLOY_URL=f'http://127.0.0.1:{server.server_port}',
                                       KEYSPILLI_ACCESS_USERNAME='fixture-user', KEYSPILLI_ACCESS_PASSWORD='fixture-password')
                            result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', step['run']],
                                                    cwd=ROOT, env=env, capture_output=True, text=True)
                            exit_code = result.returncode
                            outputs.append(result.stdout + result.stderr)
                            if result.returncode:
                                break
                        self.assertEqual(writes.exists(), may_write, ''.join(outputs))
                        if may_write:
                            self.assertEqual(exit_code, 77, ''.join(outputs))
                        else:
                            self.assertIsNotNone(exit_code)
                            self.assertNotEqual(exit_code, 0)
                            self.assertIn('version_mismatch', ''.join(outputs))
            finally:
                server.shutdown()
                thread.join()


if __name__ == '__main__':
    unittest.main()
