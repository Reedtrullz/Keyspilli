#!/usr/bin/env python3
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import selectors
import signal
import sys
import uuid

args_spec = importlib.util.spec_from_file_location("evidence_docker_args", Path(__file__).with_name("evidence_docker_args.py"))
if args_spec is None or args_spec.loader is None:
    raise RuntimeError("Docker argument parser missing")
args_module = importlib.util.module_from_spec(args_spec)
sys.modules[args_spec.name] = args_module
args_spec.loader.exec_module(args_module)
parse, value = args_module.parse, args_module.value

spec = importlib.util.spec_from_file_location("evidence", Path(__file__).with_name("keyspilli-evidence.py"))
if spec is None or spec.loader is None:
    raise RuntimeError("evidence lifecycle module is unavailable")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    store = module.Store(os.environ["KEYSPILLI_EVIDENCE_ROOT"])
    run = os.environ["KEYSPILLI_EVIDENCE_RUN"]
    real = os.environ["KEYSPILLI_REAL_DOCKER"]
    args = sys.argv[1:]
    store.guard(run)
    create_builder = False
    builder = f"keyspilli-evidence-{run}"
    with store.lock():
        path, doc = store.path(run)
        if doc["state"] != "running":
            raise ValueError("run is not writable")
        images = doc.setdefault("imageAliases", {})
        containers = doc.setdefault("containerAliases", {})
        if args[:1] == ["build"]:
            invocation = parse(args[1:], "build")
            tags = value(invocation.options, "-t", "--tag")
            if len(tags) != 1 or not tags[0].startswith("keyspilli-"):
                raise ValueError("test build requires one Keyspilli test tag")
            tag = f"keyspilli-evidence-{run}:{uuid.uuid4().hex[:12]}"
            images[tags[0]] = tag
            options = invocation.options
            options[options.index("-t" if "-t" in options else "--tag") + 1] = tag
            args = ["build", *options, *invocation.operands]
            builder = f"keyspilli-evidence-{run}"
            create_builder = not any(x["kind"] == "builder" for x in doc["resources"])
            if create_builder:
                doc["resources"].append(dict(kind="builder", name=builder))
            doc["resources"].append(dict(kind="image", name=tag))
            module.save(path, doc)
        elif args[:1] in (["run"], ["create"]):
            invocation = parse(args[1:], args[0])
            options, operands = invocation.options, invocation.operands
            if not operands or any("docker.sock" in x or x.startswith(module.LABEL + "=") for x in options):
                raise ValueError("test containers cannot control Docker")
            name = f"keyspilli-evidence-{run}-{uuid.uuid4().hex[:8]}"
            aliases = value(options, "--name")
            if len(aliases) > 1:
                raise ValueError("duplicate container name")
            if aliases:
                containers[aliases[0]] = name
                options[options.index("--name") + 1] = name
            else:
                options.extend(("--name", name))
            options = [token for token in options if token != "--rm"]
            image = images.get(operands[0], operands[0])
            mounts = set()
            for mount in value(options, "-v", "--volume"):
                parts = mount.split(":")
                if len(parts) < 2:
                    raise ValueError("anonymous/named volume binds are unsupported")
                mounts.add(parts[1])
                if len(parts) < 3 or "ro" not in parts[2].split(","):
                    source = Path(parts[0])
                    if not source.is_absolute() or not source.resolve().is_relative_to(store.root / "scratch" / run):
                        raise ValueError("writable mount escapes isolated scratch")
            mounts.update(mount.split(":", 1)[0] for mount in value(options, "--tmpfs"))
            declared = json.loads(subprocess.check_output([real, "image", "inspect", "--format", "{{json .Config.Volumes}}", image], text=True)) or {}
            for volume in declared:
                if volume not in mounts:
                    directory = store.root / "scratch" / run / "docker-volumes" / name / uuid.uuid4().hex
                    directory.mkdir(parents=True, mode=0o777)
                    directory.chmod(0o777)
                    options.extend(("-v", f"{directory}:{volume}"))
            for option, default in (("--memory", "1g"), ("--pids-limit", "128"), ("--cpus", "2")):
                if option not in options:
                    options.extend((option, default))
            if "--read-only" not in options:
                options.append("--read-only")
            args = [args[0], "--label", f"{module.LABEL}={run}", *options, image, *operands[1:]]
            doc["resources"].append(dict(kind="container", name=name))
            module.save(path, doc)
        elif args[:1] == ["buildx"] or args[:1] in (["prune"], ["volume"], ["builder"], ["system"]):
            raise ValueError("unscoped Docker mutation refused")
        elif args[:1] in (["stop"], ["start"], ["rm"], ["exec"]):
            names = {x["name"] for x in doc["resources"] if x["kind"] == "container"}
            invocation = parse(args[1:], args[0])
            target_count = 1 if args[0] == "exec" else len(invocation.operands)
            targets = [containers.get(token, token) for token in invocation.operands[:target_count]]
            if not targets or not all(token in names for token in targets):
                raise ValueError("Docker target is not owned by this run")
            for name in targets:
                label = store.docker("inspect", "--format", '{{index .Config.Labels "' + module.LABEL + '"}}', name).strip()
                if label != run:
                    raise ValueError("container ownership changed before mutation")
            if args[0] == "rm":
                identity = store.docker("info", "--format", "{{.ID}}").strip()
                if doc.get("dockerIdentity", identity) != identity:
                    raise ValueError("Docker daemon identity changed before removal")
                for name in targets:
                    store.docker("stop", "--time", "3", name)
                    logs = subprocess.run([real, "logs", name], check=True, capture_output=True, timeout=30)
                    module.durable_bytes(store.root / "evidence" / run / f"container-{name}.stdout", logs.stdout)
                    module.durable_bytes(store.root / "evidence" / run / f"container-{name}.stderr", logs.stderr)
                    module.save(store.root / "evidence" / run / f"container-{name}-state.json",
                                json.loads(store.docker("inspect", "--format", "{{json .State}}", name)))
                args = ["rm", "--volumes", *targets]
            else:
                args = [args[0], *invocation.options, *targets, *invocation.operands[target_count:]]
        elif args[:1] == ["image"] and args[1:2] not in (["inspect"], ["ls"]):
            raise ValueError("image retirement is managed by finish/recover")
        elif args[:1] not in (["image"], ["inspect"], ["ps"], ["logs"], ["port"], ["version"], ["info"], ["pull"]):
            raise ValueError("unsupported Docker operation in test run")
        else:
            args = [images.get(token, containers.get(token, token)) for token in args]
        if doc["resources"]:
            identity = store.docker("info", "--format", "{{.ID}}").strip()
            if not identity or doc.get("dockerIdentity", identity) != identity:
                raise ValueError("Docker daemon identity changed")
            doc["dockerIdentity"] = identity
            module.save(path, doc)
    if args[:1] == ["build"]:
        if create_builder:
            subprocess.run([real, "buildx", "create", "--name", builder, "--driver", "docker-container",
                            "--buildkitd-flags", "--oci-worker-gc --oci-worker-gc-keepstorage 4096"], check=True)
        args = ["buildx", "build", "--builder", builder, "--load", "--label", f"{module.LABEL}={run}", *args[1:]]
    return execute(store, run, [real, *args])


def execute(store, run, args):
    child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    stdout, stderr = child.stdout, child.stderr
    if stdout is None or stderr is None:
        raise RuntimeError("Docker output pipes are unavailable")

    def cancel(signum, _frame):
        os.killpg(child.pid, signum)
        raise InterruptedError(signum)

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, cancel)
    log_path = store.root / "evidence" / run / f"docker-{uuid.uuid4().hex}.log"
    try:
        with selectors.DefaultSelector() as selector, log_path.open("wb") as log:
            selector.register(stdout, selectors.EVENT_READ, sys.stdout.buffer)
            selector.register(stderr, selectors.EVENT_READ, sys.stderr.buffer)
            while selector.get_map():
                for key, _ in selector.select(.5):
                    chunk = os.read(key.fd, 65536)
                    if chunk:
                        log.write(chunk)
                        key.data.write(chunk)
                        key.data.flush()
                    else:
                        selector.unregister(key.fileobj)
                store.guard(run)
            code = child.wait()
            return code if code >= 0 else 128 - code
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        stdout.close()
        stderr.close()
        if log_path.exists():
            with log_path.open("rb") as stream:
                os.fsync(stream.fileno())
            module.sync_directory(log_path.parent)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"managed Docker: {error}", file=sys.stderr)
        sys.exit(1)
