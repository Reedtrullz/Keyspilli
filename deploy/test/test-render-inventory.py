#!/usr/bin/env python3
"""Fixture test for deploy/render-inventory.py (no network, no Ansible)."""
import os
import json
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RenderInventoryTest(unittest.TestCase):
    _tmp: Path | None = None

    @property
    def tmp(self) -> Path:
        assert self._tmp is not None
        return self._tmp

    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp())
        (self.tmp / "inventory").mkdir()
        shutil.copy(ROOT / "deploy" / "render-inventory.py", self.tmp / "render-inventory.py")
        shutil.copy(ROOT / "deploy" / "inventory" / "hosts.example.yml", self.tmp / "inventory" / "hosts.example.yml")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_render(self, **env):
        clean = {k: v for k, v in os.environ.items() if not k.startswith("KEYSPILLI_VPS_")}
        return subprocess.run([sys.executable, str(self.tmp / "render-inventory.py")], env={**clean, **env}, capture_output=True, text=True)

    def test_requires_host(self):
        result = self.run_render()
        self.assertEqual(result.returncode, 1)
        self.assertFalse((self.tmp / "inventory" / "hosts.yml").exists())

    def test_renders_quoted_values_with_defaults(self):
        result = self.run_render(KEYSPILLI_VPS_HOST="203.0.113.10")
        self.assertEqual(result.returncode, 0, result.stderr)
        text = (self.tmp / "inventory" / "hosts.yml").read_text()
        self.assertIn('ansible_host: "203.0.113.10"', text)
        self.assertIn('ansible_user: "deploy"', text)
        self.assertIn('ansible_ssh_private_key_file: "~/.ssh/keyspilli_deploy"', text)
        self.assertNotIn("VPS_HOST", text.split("all:", 1)[1])
        self.assertEqual((self.tmp / "inventory" / "hosts.yml").stat().st_mode & 0o777, 0o600)

    def test_rejects_injection(self):
        for value in ["host\nevil: 1", "host; rm -rf /", 'a"b']:
            result = self.run_render(KEYSPILLI_VPS_HOST=value)
            self.assertEqual(result.returncode, 1, value)

    def test_rejects_host_and_user_values_that_are_not_single_ssh_targets(self):
        for field, value in [("KEYSPILLI_VPS_HOST", "-example.test"),
                             ("KEYSPILLI_VPS_HOST", "user@example.test"),
                             ("KEYSPILLI_VPS_HOST", "example.test/path"),
                             ("KEYSPILLI_VPS_USER", "-deploy"),
                             ("KEYSPILLI_VPS_USER", "deploy@other")]:
            with self.subTest(field=field, value=value):
                env = {"KEYSPILLI_VPS_HOST": "203.0.113.10", field: value}
                result = self.run_render(**env)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertFalse((self.tmp / "inventory" / "hosts.yml").exists())

    def test_refuses_a_symlink_destination_without_touching_its_target(self):
        preserved = self.tmp / "preserved.txt"
        preserved.write_text("unique preserved bytes")
        (self.tmp / "inventory" / "hosts.yml").symlink_to(preserved)
        result = self.run_render(KEYSPILLI_VPS_HOST="203.0.113.10")
        self.assertEqual(preserved.read_text(), "unique preserved bytes")
        self.assertEqual(result.returncode, 1, result.stderr)

    def test_refuses_a_hardlinked_destination_without_touching_shared_bytes(self):
        preserved = self.tmp / "preserved.txt"
        preserved.write_text("unique preserved bytes")
        os.link(preserved, self.tmp / "inventory" / "hosts.yml")
        result = self.run_render(KEYSPILLI_VPS_HOST="203.0.113.10")
        self.assertEqual(preserved.read_text(), "unique preserved bytes")
        self.assertEqual(result.returncode, 1, result.stderr)

    def test_rendered_identity_options_override_an_operator_agent(self):
        result = self.run_render(KEYSPILLI_VPS_HOST="203.0.113.10")
        self.assertEqual(result.returncode, 0, result.stderr)
        inventory = (self.tmp / "inventory" / "hosts.yml").read_text()
        encoded = [line.split(":", 1)[1].strip() for line in inventory.splitlines()
                   if line.strip().startswith(("ansible_ssh_common_args:", "ansible_ssh_extra_args:"))]
        options = [option for value in encoded for option in shlex.split(json.loads(value))]
        config = self.tmp / "ssh_config"
        config.write_text("Host *\n  IdentityAgent /tmp/unused-keyspilli-test-agent.sock\n")
        effective = subprocess.run(["ssh", "-G", "-F", str(config), *options, "203.0.113.10"], capture_output=True, text=True)
        self.assertEqual(effective.returncode, 0, effective.stderr)
        fields = dict(line.split(None, 1) for line in effective.stdout.splitlines() if " " in line)
        self.assertEqual(fields["identityagent"], "none")

    def test_real_inventory_is_gitignored(self):
        result = subprocess.run(["git", "check-ignore", "-q", "deploy/inventory/hosts.yml"], cwd=ROOT)
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
