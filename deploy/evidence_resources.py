from dataclasses import dataclass
import re
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
