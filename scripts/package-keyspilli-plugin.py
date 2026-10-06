#!/usr/bin/env python3
"""Deterministic exact-inventory plugin ZIP; no media, model weights or installed mutations."""
import argparse,hashlib,json,os,zipfile
from pathlib import Path

def package(source,output,manifest):
    source,output,manifest=map(Path,(source,output,manifest))
    if output.exists() or manifest.exists():raise FileExistsError('exclusive new outputs required')
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
        if name!='source-members.json' and inventory['sha256'].get(name)!=digest:raise ValueError('altered source')
        rows.append({'name':name,'sha256':digest,'bytes':len(b)});payload.append((name,b))
    # Inputs are all validated before either output is created.
    with output.open('xb') as handle:
        with zipfile.ZipFile(handle,'w',compression=zipfile.ZIP_STORED) as archive:
            for name,b in payload:
                entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.create_system=3;entry.external_attr=0o100644<<16;entry.compress_type=zipfile.ZIP_STORED;archive.writestr(entry,b)
    result={'schemaVersion':1,'kind':'keyspilli-plugin-package','archiveSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'members':rows,'installedAdoption':False}
    with manifest.open('x') as handle:json.dump(result,handle,sort_keys=True,indent=2)
    return result
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);parser.add_argument('--manifest',required=True);args=parser.parse_args();print(json.dumps(package(args.source,args.output,args.manifest)))
