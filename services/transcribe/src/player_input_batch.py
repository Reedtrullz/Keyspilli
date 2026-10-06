#!/usr/bin/env python3
"""Serial, offline, bounded Player analyzer batch runner."""
import argparse, hashlib, json, math, os, re, signal, subprocess, time
from pathlib import Path

MAX_JSON = 1024 * 1024
MAX_RSS = 2 * 1024 ** 3
ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,119}$')

def bounded_json(path):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON:
        raise ValueError('absolute bounded JSON required')
    raw = path.read_bytes()
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('duplicate JSON field')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))

def validate_receipt(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 1 or value.get('kind') != 'keyspilli-player-input-evidence':
        raise ValueError('unsupported Player receipt')
    if value.get('status') not in {'matched', 'uncertain', 'unavailable', 'failed'}:
        raise ValueError('unsupported receipt status')
    resources = value.get('resources')
    if not isinstance(resources, dict): raise ValueError('receipt resources required')
    elapsed, peak = resources.get('elapsedSeconds'), resources.get('peakRssBytes')
    if type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed < 0: raise ValueError('invalid elapsed resource')
    if type(peak) is not int or peak < 0 or peak > MAX_RSS: raise ValueError('unbounded peak RSS')
    if not isinstance(value.get('limitations'), list) or not value['limitations']: raise ValueError('receipt limitations required')
    return value

def validate_manifest(path):
    rows = bounded_json(path)
    if not isinstance(rows, list) or not rows or len(rows) > 72: raise ValueError('bounded manifest rows required')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'id', 'requestPath'} or not isinstance(row['id'], str) or not ID_RE.fullmatch(row['id']) or row['id'] in seen:
            raise ValueError('neutral unique manifest IDs required')
        request = Path(row['requestPath'])
        if not request.is_absolute() or request.is_symlink() or not request.is_file() or request.stat().st_size > MAX_JSON:
            raise ValueError('absolute bounded request path required')
        seen.add(row['id'])
    return rows

def _sample_peak_rss(pid):
    try:
        for line in Path(f'/proc/{pid}/status').read_text().splitlines():
            if line.startswith('VmRSS:'): return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError): pass
    try:
        output = subprocess.check_output(['ps', '-o', 'rss=', '-p', str(pid)], text=True, timeout=1).strip()
        return int(output) * 1024 if output else 0
    except (OSError, ValueError, subprocess.SubprocessError): return 0

def run_player_case(request_path, output, *, python, timeout_seconds=120):
    request, destination, executable = Path(request_path), Path(output), Path(python)
    bounded_json(request)
    if not destination.is_absolute() or destination.exists(): raise FileExistsError('new absolute output directory required')
    if not executable.is_absolute() or not executable.is_file() or not os.access(executable, os.X_OK): raise ValueError('absolute executable Python required')
    analyzer = Path(__file__).with_name('player_input_evidence.py')
    started = time.monotonic()
    process = subprocess.Popen([str(executable), str(analyzer), '--request', str(request), '--output', str(destination)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    peak, timed_out = 0, False
    while process.poll() is None:
        peak = max(peak, _sample_peak_rss(process.pid))
        if time.monotonic() - started >= timeout_seconds:
            timed_out = True
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            break
        time.sleep(.02)
    stdout, stderr = process.communicate()
    wall = time.monotonic() - started
    receipt_path, receipt, receipt_sha = destination / 'receipt.json', None, None
    if not timed_out and process.returncode == 0 and receipt_path.is_file():
        try:
            receipt = validate_receipt(bounded_json(receipt_path))
            receipt_sha = hashlib.sha256(receipt_path.read_bytes()).hexdigest()
        except (ValueError, OSError): receipt = None
    status = 'timeout' if timed_out else ('complete' if receipt is not None else 'failed')
    return {'status': status, 'receiptPath': str(receipt_path) if receipt is not None else None, 'receipt': receipt, 'receiptSha256': receipt_sha, 'wallSeconds': wall, 'peakRssBytes': peak, 'exitCode': process.returncode, 'requestSha256': hashlib.sha256(request.read_bytes()).hexdigest(), 'error': (stderr or stdout).decode('utf-8', 'replace')[-512:] if status != 'complete' else ''}

def run_player_batch(manifest_path, output, *, python, timeout_seconds=120):
    rows = validate_manifest(manifest_path)
    destination = Path(output)
    if not destination.is_absolute() or destination.exists(): raise FileExistsError('new absolute batch output directory required')
    destination.mkdir(mode=0o700)
    resources, results = [], []
    for row in rows:
        result = run_player_case(row['requestPath'], destination / row['id'], python=python, timeout_seconds=timeout_seconds)
        resources.append({'id': row['id'], 'status': result['status'], 'wallSeconds': result['wallSeconds'], 'peakRssBytes': result['peakRssBytes'], 'exitCode': result['exitCode'], 'requestSha256': result['requestSha256'], 'receiptPath': result['receiptPath'], 'receiptSha256': result['receiptSha256'], 'error': result['error']})
        if result['receipt'] is not None: results.append({'id': row['id'], 'receipt': result['receipt']})
    with (destination / 'results.json').open('x') as handle: json.dump(results, handle, allow_nan=False, sort_keys=True, indent=2)
    with (destination / 'resources.json').open('x') as handle: json.dump({'schemaVersion': 1, 'kind': 'keyspilli-player-batch-resources', 'cases': resources}, handle, allow_nan=False, sort_keys=True, indent=2)
    return {'cases': len(rows), 'complete': len(results), 'failedOrIncomplete': len(rows) - len(results), 'output': str(destination)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True); parser.add_argument('--output', required=True); parser.add_argument('--python', required=True); parser.add_argument('--timeout', type=float, default=120)
    args = parser.parse_args()
    print(json.dumps(run_player_batch(args.manifest, args.output, python=args.python, timeout_seconds=args.timeout), sort_keys=True))

if __name__ == '__main__': main()
