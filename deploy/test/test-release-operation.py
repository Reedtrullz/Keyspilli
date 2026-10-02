#!/usr/bin/env python3
import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "validate-release-operation.py"
spec = importlib.util.spec_from_file_location("release_operation", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.validate("deploy_only", "", "strict", "") is False
assert module.validate("rebuild_target", "song-123", "preserve-melody", "") is True
assert module.validate("rebuild_all", "", "strict", "REBUILD_ALL_CATALOG") is True
for args in [
    ("unknown", "", "strict", ""), ("deploy_only", "song", "strict", ""),
    ("rebuild_target", "", "strict", ""), ("rebuild_target", "../private", "strict", ""),
    ("rebuild_all", "", "strict", ""), ("rebuild_all", "song", "strict", "REBUILD_ALL_CATALOG"),
    ("rebuild_all", "", "preserve-melody", "REBUILD_ALL_CATALOG"),
]:
    try: module.validate(*args)
    except ValueError: pass
    else: raise AssertionError(f"accepted invalid operation {args}")
workflow = (path.parents[1] / ".github/workflows/ci.yml").read_text()
assert "default: deploy_only" in workflow
assert "inputs.operation != 'deploy_only'" in workflow
assert "python3 deploy/validate-release-operation.py" in workflow
print("release operation fixtures passed")
