#!/usr/bin/env python3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXTRA = "/services/transcribe/test/*.py"


class WebDockerignoreTests(unittest.TestCase):
    def test_web_context_preserves_root_and_omits_only_python_tests(self):
        shared = (ROOT / ".dockerignore").read_text()
        web = (ROOT / "apps/web/Dockerfile.dockerignore").read_text()
        self.assertTrue(web.startswith(shared))
        extra = [line for line in web[len(shared):].splitlines() if line and not line.startswith("#")]
        self.assertEqual(extra, [EXTRA])
        self.assertNotIn(EXTRA, shared)
        self.assertNotIn(EXTRA, (ROOT / "services/transcribe/Dockerfile.tutorial.dockerignore").read_text())


if __name__ == "__main__":
    unittest.main()
