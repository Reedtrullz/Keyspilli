#!/usr/bin/env python3
"""Deterministic exact-inventory plugin ZIP; no media, model weights or installed mutations."""
import argparse,hashlib,json,os,re,zipfile
from pathlib import Path
from urllib.parse import unquote

def heading_anchors(file):
    counts={};anchors=set()
    for heading in re.findall(r'^#{1,6}\s+(.+?)\s*#*\s*$',file.read_text(),re.MULTILINE):
        slug=re.sub(r'[^\w\- ]','',heading.lower()).replace(' ','-')
        count=counts.get(slug,0);counts[slug]=count+1
        anchors.add(slug+(f'-{count}' if count else ''))
    return anchors

def validate_references(source):
    """Check local Markdown targets against the exact package, not the checkout."""
    root=Path(source).resolve();checked=[]
    for file in sorted(root.rglob('*.md')):
        for target in re.findall(r'\]\(([^)]+)\)',file.read_text()):
            target=target.strip().split(' "',1)[0].strip('<>')
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',target) or target.startswith('/'):continue
            path,separator,fragment=target.partition('#')
            resolved=(file.parent/path).resolve() if path else file.resolve()
            if not resolved.is_relative_to(root) or not resolved.is_file():raise ValueError(f'missing or out-of-package reference: {file.relative_to(root)} -> {target}')
            if separator and fragment and resolved.suffix=='.md' and unquote(fragment) not in heading_anchors(resolved):raise ValueError(f'missing reference fragment: {file.relative_to(root)} -> {target}')
            checked.append({'from':file.relative_to(root).as_posix(),'target':target})
    return checked

def collect_members(source,check_hashes=True):
    source=Path(source)
    if source.is_symlink() or not source.is_dir():raise ValueError('source must be a real directory')
    inventory=json.loads((source/'source-members.json').read_text());members=inventory['members']
    actual=sorted(p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file())
    if members!=sorted(set(members)) or actual!=members or any(p.is_symlink() for p in source.rglob('*')):raise ValueError('undeclared, missing or symlinked member')
    if set(inventory['sha256'])!=set(members)-{'source-members.json'}:raise ValueError('source hash inventory mismatch')
    rows=[];payload=[]
    for name in members:
        if name.startswith('/') or '..' in Path(name).parts or any(part in {'.DS_Store','output','node_modules','__pycache__','.git','assets','models','dictionary'} for part in Path(name).parts) or Path(name).suffix in {'.wav','.mp3','.ogg','.npy','.pth','.safetensors','.pem','.env','.pyc'}:raise ValueError('private or unsupported member')
        b=(source/name).read_bytes()
        if len(b)>1024*1024:raise ValueError('member exceeds bound')
        digest=hashlib.sha256(b).hexdigest()
        if check_hashes and name!='source-members.json' and inventory['sha256'].get(name)!=digest:raise ValueError('altered source')
        rows.append({'name':name,'sha256':digest,'bytes':len(b)});payload.append((name,b))
    return rows,payload

def package(source,output,manifest):
    source,output,manifest=map(Path,(source,output,manifest))
    if output.exists() or manifest.exists():raise FileExistsError('exclusive new outputs required')
    rows,payload=collect_members(source)
    references=validate_references(source)
    # Inputs are all validated before either output is created.
    with output.open('xb') as handle:
        with zipfile.ZipFile(handle,'w',compression=zipfile.ZIP_STORED) as archive:
            for name,b in payload:
                entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.create_system=3;entry.external_attr=0o100644<<16;entry.compress_type=zipfile.ZIP_STORED;archive.writestr(entry,b)
    result={'schemaVersion':1,'kind':'keyspilli-plugin-package','archiveSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'sourceTreeSha256':hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'members':rows,'checkedReferences':references,'installedAdoption':False}
    with manifest.open('x') as handle:json.dump(result,handle,sort_keys=True,indent=2)
    return result
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);parser.add_argument('--manifest',required=True);args=parser.parse_args();print(json.dumps(package(args.source,args.output,args.manifest)))
