from dataclasses import dataclass
import re
import json
import time
from typing import Literal


@dataclass(frozen=True)
class Resource:
    kind: Literal["container", "image", "builder"]
    name: str


def decode(value: object, run: str) -> Resource:
    if not isinstance(value, dict):
        raise ValueError("invalid resource record")
    name = value.get("name")
    kind = value.get("kind")
    if not isinstance(name, str):
        raise ValueError("invalid resource name")
    prefix = "keyspilli-evidence-" + re.escape(run)
    if kind == "container" and re.fullmatch(prefix + "-[a-f0-9]{8}", name):
        return Resource("container", name)
    if kind == "image" and re.fullmatch(prefix + ":[a-f0-9]{12}", name):
        return Resource("image", name)
    if kind == "builder" and name == "keyspilli-evidence-" + run:
        return Resource("builder", name)
    raise ValueError("resource is not explicitly owned by this run")


def close_builder(store, doc, name, persist):
    volume = "buildx_buildkit_" + name + "0_state"
    expected = "/buildx_buildkit_" + name + "0"

    def users():
        result = []
        for identity in store.docker("ps", "-aq", "--no-trunc", "--filter", "volume=" + volume).split():
            info = json.loads(store.docker("inspect", identity))[0]
            mounts = info.get("Mounts", [])
            if info.get("Id") != identity or info.get("Name") != expected or not any(mount.get("Type") == "volume" and mount.get("Name") == volume for mount in mounts):
                raise ValueError("builder state has a foreign or replaced container reference")
            result.append(identity)
        return sorted(result)

    original = users()
    journal = doc.setdefault("builderContainers", {})
    if name in journal and original and original != journal[name]:
        raise ValueError("builder container identity changed")
    if name not in journal:
        journal[name] = original
        persist()
    names = store.docker("buildx", "ls", "--format", "{{.Name}}", buildx_run=doc["id"]).split()
    if name in names:
        if users() != original:
            raise ValueError("builder ownership changed before removal")
        store.docker("buildx", "rm", name, buildx_run=doc["id"])
    deadline = time.monotonic() + 3
    while True:
        remaining = users()
        if not remaining:
            break
        if remaining != original or not original:
            raise ValueError("builder state was attached to a replacement container")
        if time.monotonic() >= deadline:
            raise ValueError("builder state volume remains in use")
        time.sleep(.05)
    if volume in store.docker("volume", "ls", "-q", "--filter", "name=" + volume).split():
        if users():
            raise ValueError("builder state volume became active again")
        store.docker("volume", "rm", volume)
