import fcntl
import hashlib
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from typing import Protocol, TypedDict, cast
from scripts.keyspilli_workflow_api_runtime import RuntimeBasis


class OptionalAssetPin(TypedDict, total=False):
    files: dict[str, str]


class AssetPin(OptionalAssetPin):
    path: str
    sha256: str | None


class OptionalFixture(TypedDict, total=False):
    renderer2: str
    prepared: str
    phrasePlan: str
    negativeCondition: str
    ocxExecutable: str


class Fixture(OptionalFixture):
    source: str
    instruction: str
    node: str
    soundfont: str
    renderer: str
    description: str
    title: str
    artist: str
    assets: dict[str, AssetPin]


class Cell(TypedDict):
    id: str
    task: str
    model: str
    skill: str
    repetition: int
    expected: str
    status: str
    attempted_calls: int
    verified: bool


class Snapshot(TypedDict):
    path: str
    inventorySha256: str
    skillSha256: str
    sourceTreeSha256: str


class Experiment(TypedDict):
    benchmarkId: str
    checkout: str
    applicationHead: str
    applicationTree: str
    skillSnapshots: dict[str, Snapshot]
    cells: list[Cell]


class HeldReservation(Protocol):
    @property
    def cost(self) -> float: ...


class BudgetPort(Protocol):
    cap: float
    spent: float
    stopped: bool
    unknown_usage_calls: int
    native_quota_verified: bool
    def reserve(self, model: str, input_tokens_bound: int, output_tokens_bound: int) -> HeldReservation: ...
    def settle(self, reservation: HeldReservation, usage: dict[str, int] | None, model: str) -> None: ...


def load_module(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), Path(__file__).with_name(name + ".py"))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def pin_asset(path: Path) -> AssetPin:
    real = path.resolve()
    if not real.exists():
        return {"path": str(real), "sha256": None}
    if real.is_file() and real.stat().st_size <= 256 * 1024 * 1024:
        return {"path": str(real), "sha256": sha(real)}
    if not real.is_dir():
        raise ValueError("fixture must be a bounded regular asset or prepared directory")
    members = sorted(real.rglob("*"))
    if len(members) > 2048 or any(p.is_symlink() for p in members):
        raise ValueError("prepared fixture exceeds bound or contains aliases")
    files = {p.relative_to(real).as_posix(): sha(p) for p in members if p.is_file()}
    if sum((real / name).stat().st_size for name in files) > 256 * 1024 * 1024:
        raise ValueError("prepared fixture exceeds 256 MiB")
    return {"path": str(real), "sha256": hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(), "files": files}


def pin_fixture(value: dict[str, str]) -> Fixture:
    assets = {key: pin_asset(Path(value[key])) for key in ("source", "instruction", "node", "soundfont", "renderer", "renderer2", "prepared", "phrasePlan", "ocxExecutable") if value.get(key)}
    fixture: Fixture = {"source": value["source"], "instruction": value["instruction"], "node": value["node"],
        "soundfont": value["soundfont"], "renderer": value["renderer"], "description": value["description"],
        "title": value["title"], "artist": value["artist"], "assets": assets}
    if value.get("renderer2"): fixture["renderer2"] = value["renderer2"]
    if value.get("prepared"): fixture["prepared"] = value["prepared"]
    if value.get("phrasePlan"): fixture["phrasePlan"] = value["phrasePlan"]
    if value.get("negativeCondition"): fixture["negativeCondition"] = value["negativeCondition"]
    if value.get("ocxExecutable"): fixture["ocxExecutable"] = value["ocxExecutable"]
    return fixture


def check_fixture(fixture: Fixture) -> None:
    paths = {key for key in ("source", "instruction", "node", "soundfont", "renderer", "renderer2", "prepared", "phrasePlan", "ocxExecutable") if fixture.get(key)}
    if set(fixture["assets"]) != paths:
        raise ValueError("fixture asset inventory does not cover consumed paths")
    for key, expected in fixture["assets"].items():
        if expected["sha256"] is None and key not in ("renderer", "renderer2"):
            raise ValueError(f"required fixture asset is missing: {key}")
        if pin_asset(Path(str(fixture[key]))) != expected:
            raise ValueError(f"fixture asset changed: {key}")


def check_source(experiment: Experiment) -> None:
    checkout = Path(experiment["checkout"])
    head = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    tree = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD^{tree}"], text=True).strip()
    if head != experiment["applicationHead"] or tree != experiment["applicationTree"] or subprocess.check_output([
        "git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=no"]):
        raise ValueError("application source changed after freeze")
    packager = load_module("package-keyspilli-plugin")
    for snapshot in experiment["skillSnapshots"].values():
        source = Path(snapshot["path"])
        if sha(source / "source-members.json") != snapshot["inventorySha256"] or sha(source / "skills/keyspilli-song/SKILL.md") != snapshot["skillSha256"]:
            raise ValueError("skill snapshot changed")
        packager.collect_members(source)


def admit_results(root: Path, experiment: Experiment, fixtures: dict[str, Fixture]) -> None:
    if root.absolute() != root.resolve():
        raise ValueError("results must not use path aliases")
    checkout = Path(experiment["checkout"]).resolve()
    if root.is_relative_to(checkout) and not root.is_relative_to(checkout / "output"):
        raise ValueError("results cannot write protected application source")
    protected = [Path(s["path"]).resolve() for s in experiment["skillSnapshots"].values()]
    protected += [Path(asset["path"])
                  for fixture in fixtures.values() for asset in fixture["assets"].values()]
    if any(root.is_relative_to(path) or path.is_relative_to(root) for path in protected):
        raise ValueError("results overlap a frozen snapshot or fixture")
    if not root.parent.is_dir():
        raise ValueError("results parent must already exist")
    for cell in experiment["cells"]:
        if not (root / cell["id"]).resolve().is_relative_to(root.resolve()):
            raise ValueError("cell destination escapes results")


class Admission:
    def __init__(self, experiment_path: Path, fixtures_path: Path, results: Path):
        core = load_module("evaluate-keyspilli-workflow")
        raw = json.loads(experiment_path.read_text())
        canonical = [{**c, "status": "not-run", "attempted_calls": 0, "verified": False} for c in core.matrix()]
        if raw.get("benchmarkId") != "keyspilli-next-update-v1" or json.dumps(raw.get("cells"), sort_keys=True) != json.dumps(canonical, sort_keys=True):
            raise ValueError("experiment does not contain the exact canonical 96-cell matrix")
        self.experiment = cast(Experiment, raw)
        self.fixtures = cast(dict[str, Fixture], json.loads(fixtures_path.read_text()))
        if set(self.fixtures) != set(core.TASKS):
            raise ValueError("fixture tasks differ from the frozen matrix")
        for fixture in self.fixtures.values():
            check_fixture(fixture)
        check_source(self.experiment)
        admit_results(results, self.experiment, self.fixtures)
        checkout = Path(self.experiment["checkout"])
        common = Path(subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "--git-common-dir"], text=True).strip())
        common = common if common.is_absolute() else checkout / common
        self.accounting_root = common.resolve() / "keyspilli-evaluations/keyspilli-next-update-v1"
        self.accounting_root.mkdir(parents=True, exist_ok=True)
        self.lock = (self.accounting_root / "exclusive.lock").open("a")
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            self._bind_lineage(experiment_path, fixtures_path, results)
        except BaseException:
            self.lock.close()
            raise
        self.journal = self.accounting_root / "admissions.jsonl"
        self.accounted_usd = 0.0
        self.stopped = False
        self.unknown_usage_calls = 0
        self.blocked_routes: dict[str, str] = {}
        if self.journal.exists():
            for line in self.journal.read_text().splitlines():
                record = json.loads(line)
                self.accounted_usd += record.get("reservedUsd", 0) + record.get("deltaUsd", 0)
                self.stopped |= record.get("stopped", False)
                self.unknown_usage_calls += record.get("kind") == "settled" and record.get("usage") is None
                if record.get("kind") == "route-blocked": self.blocked_routes[record["model"]] = record["reason"]

    def _bind_lineage(self, experiment_path: Path, fixtures_path: Path, results: Path) -> None:
        configuration = self.accounting_root / (sha(experiment_path) + ".json")
        expected = {"experimentSha256": sha(experiment_path), "fixturesSha256": sha(fixtures_path), "results": str(results.resolve())}
        if configuration.exists():
            if json.loads(configuration.read_text()) != expected:
                raise ValueError("this experiment already has a different results or fixture lineage")
        else:
            if results.exists() and any(results.iterdir()):
                raise ValueError("new experiment cannot adopt an existing populated results directory")
            with configuration.open("x") as handle:
                json.dump(expected, handle, indent=2)
        results.mkdir(exist_ok=True)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.lock.close()

    def append(self, record: dict[str, object]) -> None:
        with self.journal.open("a") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def recheck(self, task: str) -> None:
        check_source(self.experiment)
        check_fixture(self.fixtures[task])
        fixture = self.fixtures[task]
        if task == "missing-renderer" and fixture["assets"]["renderer"]["sha256"] is not None:
            raise ValueError("missing-renderer task has an existing backend")
        if task == "unqualified-url" and (fixture.get("source") or fixture.get("prepared")):
            raise ValueError("unqualified URL task must not invent qualified local bytes")
        if task == "existing-preparation" and not fixture.get("prepared"):
            raise ValueError("existing-preparation task needs its frozen prepared inventory")
        if task == "stale-phrase-pin" and not fixture.get("phrasePlan"):
            raise ValueError("stale-phrase-pin task needs its frozen working plan")

    def admission_count(self, cell_id: str) -> int:
        if not self.journal.exists(): return 0
        return sum(record.get("kind") == "dispatched" and record.get("cell") == cell_id
            for record in (json.loads(line) for line in self.journal.read_text().splitlines()))

    def block_route(self, model: str, reason: str) -> None:
        self.blocked_routes[model] = reason
        self.append({"kind": "route-blocked", "model": model, "reason": reason})

    def bind_runtime(self, runtime: RuntimeBasis, model: str) -> None:
        basis = {key: value for key, value in runtime.items() if key not in ("checkedAt", "nativeWeeklyUsedPercent")}
        path = self.accounting_root / ("runtime-" + model.replace("/", "_") + ".json")
        if path.exists():
            if json.loads(path.read_text()) != basis: raise ValueError("qualified runtime/entitlement changed during this campaign")
        else:
            with path.open("x") as handle: json.dump(basis, handle, indent=2)
