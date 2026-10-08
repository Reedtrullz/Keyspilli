#!/usr/bin/env python3
"""Read-only overlay2 reconciliation and Keyspilli image layer reuse report.

Unreferenced registered chains are candidates for investigation, not deletion
instructions. No daemon restart, recovery import, or internal store write.
"""
import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def chains(diffs):
    result = []
    chain = None
    for diff in diffs:
        chain = diff if chain is None else "sha256:" + hashlib.sha256((chain + " " + diff).encode()).hexdigest()
        result.append(chain)
    return result


def closure(roots, records):
    found = set()
    for chain in roots:
        while chain and chain not in found:
            if chain not in records:
                raise ValueError("missing registered chain; inventory raced or is inconsistent")
            found.add(chain)
            chain = records[chain]["parent"]
    return found


def reconcile(root, api_images, proc=Path("/proc")):
    ldb = root / "image/overlay2/layerdb"
    records = {}
    for d in (ldb / "sha256").iterdir():
        if re.fullmatch(r"[a-f0-9]{64}", d.name):
            records["sha256:" + d.name] = {
                "cache": (d / "cache-id").read_text().strip(),
                "parent": (d / "parent").read_text().strip() if (d / "parent").exists() else None,
            }
    roots = set()
    for image in api_images:
        roots.update(chains(image.get("RootFS", {}).get("Layers") or []))
    configs = list((root / "image/overlay2/imagedb/content/sha256").iterdir())
    for p in configs:
        roots.update(chains(json.loads(p.read_text()).get("rootfs", {}).get("diff_ids", [])))
    mount_caches, mounts = set(), list((ldb / "mounts").iterdir())
    for d in mounts:
        if (d / "parent").exists():
            roots.add((d / "parent").read_text().strip())
        for key in ("mount-id", "init-id"):
            if (d / key).exists():
                mount_caches.add((d / key).read_text().strip())
    runtime = set()
    def refs(text):
        for match in re.findall(re.escape(str(root / "overlay2")) + r"/([^\s,:;]+)", text):
            parts = match.split("/")
            if parts[0] == "l" and len(parts) > 1:
                try:
                    runtime.add((root / "overlay2/l" / parts[1]).resolve(strict=True).parent.name)
                except FileNotFoundError:
                    pass
            else:
                runtime.add(parts[0])
    for process in proc.iterdir():
        if not process.name.isdigit():
            continue
        for file in (process / "mountinfo", process / "maps"):
            try:
                refs(file.read_text())
            except OSError as e:
                if e.errno not in (errno.ENOENT, errno.ESRCH, errno.EINVAL):
                    raise
        try:
            for fd in (process / "fd").iterdir():
                try:
                    refs(os.readlink(fd))
                except (FileNotFoundError, ProcessLookupError):
                    pass
        except (FileNotFoundError, ProcessLookupError):
            pass
    roots.update(k for k, r in records.items() if r["cache"] in runtime)
    protected = closure(roots, records)
    orphan = set(records) - protected
    known_caches = {r["cache"] for r in records.values()} | mount_caches | runtime
    unknown = {p.name for p in (root / "overlay2").iterdir() if p.is_dir() and p.name != "l"} - known_caches
    paths = [root / "overlay2" / records[c]["cache"] for c in orphan]
    sizes = {}
    if paths:
        output = subprocess.check_output(["du", "-s", "-x", "-B1", *map(str, paths)], text=True, timeout=180)
        sizes = {Path(line.split(None, 1)[1]).name: int(line.split(None, 1)[0]) for line in output.splitlines()}
    return {"registeredLayers": len(records), "apiImages": len(api_images), "imageConfigs": len(configs),
            "containerMountRecords": len(mounts), "orphanCandidateChains": sorted(orphan),
            "orphanCandidateBytes": sum(sizes.values()), "unregisteredCacheDirectories": sorted(unknown),
            "action": "report only; fresh operator investigation required"}


def reuse_report(images):
    result = []
    for repo in ("ghcr.io/reedtrullz/keyspilli:", "ghcr.io/reedtrullz/keyspilli-worker:"):
        group = sorted((i for i in images if any(t.startswith(repo) for t in i.get("RepoTags") or [])),
                       key=lambda i: i["Created"], reverse=True)
        for new, old in zip(group, group[1:]):
            a, b = new["RootFS"]["Layers"], old["RootFS"]["Layers"]
            shared = 0
            for x, y in zip(a, b):
                if x != y:
                    break
                shared += 1
            result.append({"new": new["Id"], "old": old["Id"], "repository": repo[:-1],
                           "sharedPrefixLayers": shared, "newLayers": len(a) - shared,
                           "newImageBytes": new["Size"], "oldImageBytes": old["Size"]})
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--docker", default="docker")
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    def run(*argv):
        return subprocess.check_output([args.docker, *argv], text=True, timeout=120).strip()
    info = json.loads(run("info", "--format", "{{json .}}"))
    ids = sorted(set(run("image", "ls", "-aq", "--no-trunc").splitlines()))
    images = json.loads(run("image", "inspect", *ids)) if ids else []
    report = {"engine": run("version", "--format", "{{.Server.Version}}"), "driver": info["Driver"],
              "layerReuse": reuse_report(images), "dockerUsage": run("system", "df")}
    if info["Driver"] != "overlay2":
        report["reconciliation"] = "unsupported driver; no orphan-free claim"
    else:
        report["reconciliation"] = reconcile(Path(info["DockerRootDir"]), images)
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        # Store one bounded current report, outside Docker internals.
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temp = args.output.with_suffix(".tmp")
        temp.write_text(text)
        os.replace(temp, args.output)
    print(text)
    if isinstance(report["reconciliation"], dict) and report["reconciliation"]["orphanCandidateChains"]:
        sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as e:
        print(json.dumps({"error": str(e), "reconciliation": "incomplete; no orphan-free claim"}))
        sys.exit(1)
