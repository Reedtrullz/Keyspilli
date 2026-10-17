#!/usr/bin/env python3
"""Fixture test for deploy/render-inventory.py (no network, no Ansible)."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class RenderInventoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
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

    def test_real_inventory_is_gitignored(self):
        result = subprocess.run(["git", "check-ignore", "-q", "deploy/inventory/hosts.yml"], cwd=ROOT)
        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
