import hashlib
import json
import math
import subprocess
import urllib.request
import signal
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import TypedDict


class RuntimeBasis(TypedDict):
    model: str
    checkedAt: str
    nativeQuotaIncluded: bool
    nativeAccountIdentitySha256: str
    nativePlan: str
    nativeWeeklyUsedPercent: float
    routes: dict[str, str]
    ratesUsdPerMillion: dict[str, list[float]]
    shadowCallsDisabled: bool
    ocxExecutable: str
    ocxVersion: str


class Capabilities(TypedDict, total=False):
    supports_tool_use: bool


class ApiModel(TypedDict, total=False):
    id: str
    owned_by: str
    api_types: list[str]
    capabilities: Capabilities


class Catalog(TypedDict, total=False):
    data: list[ApiModel]


class Provider(TypedDict, total=False):
    name: str
    baseUrl: str
    adapter: str
    authMode: str


class Quota(TypedDict, total=False):
    weeklyPercent: float


class QuotaRefresh(TypedDict, total=False):
    status: str


class Account(TypedDict, total=False):
    id: str
    provider: str
    active: bool
    type: str
    plan: str
    needsReauth: bool
    paused: bool
    creditsAfterLimit: bool
    health: str
    quota: Quota
    quotaRefresh: QuotaRefresh


class Accounts(TypedDict, total=False):
    accounts: list[Account]


class Shadow(TypedDict, total=False):
    enabled: bool


class Rates(TypedDict, total=False):
    input: float
    output: float


class Price(TypedDict, total=False):
    provider: str
    modelId: str
    effectiveCost: Rates


@contextmanager
def absolute_deadline(deadline: float):
    remaining = deadline - time.monotonic()
    if remaining <= 0: raise TimeoutError("session deadline exhausted")
    def expired(_signal, _frame):
        raise TimeoutError("session deadline exhausted")
    previous_handler = signal.signal(signal.SIGALRM, expired)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, remaining)
    started = time.monotonic()
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            signal.setitimer(signal.ITIMER_REAL, max(.000001, previous_timer[0] - (time.monotonic() - started)), previous_timer[1])


def ocx(executable: str, *args: str):
    return json.loads(subprocess.check_output([executable, *args, "--json"], text=True, timeout=30))


def qualify_runtime(model: str, executable: str) -> RuntimeBasis:
    version = subprocess.check_output([executable, "--version"], text=True, timeout=10).strip()
    status = ocx(executable, "status")
    if status.get("versionSkew", {}).get("relation") != "match" or status.get("proxy", {}).get("running") is not True:
        raise ValueError("pinned OCX CLI and live proxy are not the same ready version")
    with urllib.request.urlopen("http://127.0.0.1:10100/v1/models", timeout=10) as response:
        catalog = json.loads(response.read(1024 * 1024))
    providers = ocx(executable, "provider", "list")["configured"]
    accounts: Accounts = ocx(executable, "account", "list", "openai", "--quota", "--refresh") if model == "gpt-6-luna" else {"accounts": []}
    shadow = ocx(executable, "models", "shadow", "status")
    price: Price = ocx(executable, "models", "price", "B.AI/mimo-v2.6-flash") if model == "B.AI/mimo-v2.6-flash" else {}
    result = validate_runtime(model, catalog, providers, accounts, shadow, price)
    if model == "gpt-6-luna":
        if ocx(executable, "config", "get", "codexAccountNamespaces.main") != "@main":
            raise ValueError("existing main selector is not bound to the included native account")
        preview = ocx(executable, "api", "explain", "--model", "main/gpt-6-luna", "--inbound", "chat")
        candidates = preview.get("candidates", [])
        if len(candidates) != 1 or candidates[0].get("provider") != "openai" or candidates[0].get("model") != "gpt-6-luna" or candidates[0].get("eligible") is not True or candidates[0].get("fidelity") != "preserved":
            raise ValueError("existing exact-account Luna transport is not qualified")
    result["ocxExecutable"], result["ocxVersion"] = executable, version
    return result


def validate_runtime(model: str, catalog: Catalog, providers: list[Provider], accounts: Accounts, shadow: Shadow, price: Price) -> RuntimeBasis:
    if model not in ("gpt-6-luna", "B.AI/mimo-v2.6-flash"): raise ValueError("unapproved workflow model")
    routes = {p.get("name", ""): p for p in providers if p.get("name") in ("openai", "B.AI")}
    if model == "gpt-6-luna" and (routes.get("openai", {}).get("baseUrl") != "https://chatgpt.com/backend-api/codex" or routes["openai"].get("adapter") != "openai-responses" or routes["openai"].get("authMode") != "forward"):
        raise ValueError("Luna's exact API route is not the included Codex backend")
    if model == "B.AI/mimo-v2.6-flash" and (routes.get("B.AI", {}).get("baseUrl") != "https://api.b.ai/v1/chat/completions" or routes["B.AI"].get("adapter") != "openai-chat"):
        raise ValueError("MiMo's exact API provider route is not qualified")
    models = {m.get("id", ""): m for m in catalog.get("data", []) if m.get("id") in ("gpt-6-luna", "B.AI/mimo-v2.6-flash")}
    for selected, owner in (("gpt-6-luna", "openai"), ("B.AI/mimo-v2.6-flash", "B.AI")):
        if selected != model: continue
        row = models.get(selected, {})
        if row.get("owned_by") != owner or "chat_completions" not in row.get("api_types", []) or row.get("capabilities", {}).get("supports_tool_use") is not True:
            raise ValueError("exact API model route/tool capabilities not qualified")
    return validate_entitlement(model, accounts, shadow, price, routes)


def validate_entitlement(model: str, accounts: Accounts, shadow: Shadow, price: Price, routes: dict[str, Provider]) -> RuntimeBasis:
    if shadow.get("enabled") is not False: raise ValueError("unbudgeted shadow calls are not allowed")
    if model == "B.AI/mimo-v2.6-flash":
        rates = price.get("effectiveCost", {})
        if price.get("provider") != "B.AI" or price.get("modelId") != "mimo-v2.6-flash" or rates.get("input") != .14 or rates.get("output") != .28:
            raise ValueError("MiMo rates changed or are unknown; do not admit paid requests")
        return {"model": model, "checkedAt": datetime.now(timezone.utc).isoformat(), "nativeQuotaIncluded": False,
            "ocxExecutable": "", "ocxVersion": "",
            "nativeAccountIdentitySha256": "", "nativePlan": "", "nativeWeeklyUsedPercent": 0,
            "routes": {"B.AI": routes["B.AI"].get("baseUrl", "")}, "ratesUsdPerMillion": {model: [.14, .28]}, "shadowCallsDisabled": True}
    active = [a for a in accounts.get("accounts", []) if a.get("provider") == "openai" and a.get("active") is True]
    if len(active) != 1: raise ValueError("one active native Codex account is required")
    account = active[0]
    account_id = account.get("id")
    if account_id != "__main__": raise ValueError("included native main account identity is not verified")
    percent = account.get("quota", {}).get("weeklyPercent")
    if account.get("type") != "codex" or account.get("plan") not in ("pro", "prolite", "plus", "team", "business", "enterprise") or account.get("needsReauth") is not False or account.get("paused") is not False or account.get("creditsAfterLimit") is not False or account.get("health") != "Healthy" or account.get("quotaRefresh", {}).get("status") != "ok":
        raise ValueError("included native entitlement with after-limit spending disabled is not verified")
    if not isinstance(percent, (int, float)) or isinstance(percent, bool) or not math.isfinite(percent) or not 0 <= percent < 100:
        raise ValueError("native quota observation missing or exhausted")
    return {"model": model, "checkedAt": datetime.now(timezone.utc).isoformat(), "nativeQuotaIncluded": True,
        "ocxExecutable": "", "ocxVersion": "",
        "nativeAccountIdentitySha256": hashlib.sha256(account_id.encode()).hexdigest(), "nativePlan": account.get("plan", ""),
        "nativeWeeklyUsedPercent": float(percent), "routes": {name: p.get("baseUrl", "") for name, p in routes.items()},
        "ratesUsdPerMillion": {"gpt-6-luna": [0, 0]}, "shadowCallsDisabled": True}
