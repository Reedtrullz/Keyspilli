#!/usr/bin/env python3
"""Isolated, synthetic decoder measurements; never mounts owner data or pulls images."""
import argparse
import json
import re
import subprocess
import uuid
from pathlib import Path


def limits(cpus, memory_mib, pids):
    if isinstance(cpus, bool) or not isinstance(cpus, (int, float)) or not .25 <= cpus <= 32:
        raise ValueError('cpus must be 0.25–32')
    if type(memory_mib) is not int or not 64 <= memory_mib <= 65536 or type(pids) is not int or not 16 <= pids <= 4096:
        raise ValueError('memory_mib must be 64–65536; pids must be 16–4096')
    return ['--cpus', str(cpus), '--memory', f'{memory_mib}m', '--memory-swap', f'{memory_mib}m', '--pids-limit', str(pids)]


DECODER = r'''
import json,resource,subprocess,time
from pathlib import Path

def number(name):
 try:return int((Path('/sys/fs/cgroup')/name).read_text())
 except (ValueError,OSError):return None

def cpu():
 try:return int(dict(line.split() for line in Path('/sys/fs/cgroup/cpu.stat').read_text().splitlines())['usage_usec'])
 except (KeyError,ValueError,OSError):return None
start=time.monotonic();peak_pids=number('pids.current') or 0;peak_memory=number('memory.current') or 0;before=cpu();peak_cpu=0
commands=[['ffmpeg','-v','error','-f','lavfi','-i',f'sine=frequency=440:sample_rate=48000:duration={DURATION}','-threads','1','-filter_threads','1','/tmp/synthetic.mp3'],['ffmpeg','-v','error','-i','/tmp/synthetic.mp3','-threads','1','-filter_threads','1','-ac','1','-ar','16000','/tmp/decoded.wav']]
for command in commands:
 proc=subprocess.Popen(command,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);sample=time.monotonic();last=cpu()
 while proc.poll() is None:
  peak_pids=max(peak_pids,number('pids.current') or 0);peak_memory=max(peak_memory,number('memory.current') or 0)
  now=time.monotonic();current=cpu()
  if now-sample>=.1 and current is not None and last is not None:peak_cpu=max(peak_cpu,(current-last)/1e6/(now-sample)*100);sample=now;last=current
  if now-start>35:proc.kill();raise RuntimeError('decoder measurement timed out')
  time.sleep(.01)
 stderr=proc.communicate()[1]
 if proc.returncode:raise RuntimeError(f'decoder exited {proc.returncode}; inspect local runtime capability')
usage=resource.getrusage(resource.RUSAGE_CHILDREN);after=cpu()
print(json.dumps({'fixture':'generated-sine-mp3-to-mono-wav','duration_seconds':DURATION,'latency_seconds':round(time.monotonic()-start,4),'child_peak_rss_bytes':usage.ru_maxrss*1024,'cgroup_peak_memory_bytes':number('memory.peak') or peak_memory,'sampled_peak_pids':peak_pids,'cpu_seconds':None if before is None or after is None else (after-before)/1e6,'sampled_peak_cpu_percent':round(peak_cpu,2),'sample_interval_seconds':.01,'cpu_window_seconds':.1,'output_bytes':Path('/tmp/decoded.wav').stat().st_size}))
'''
OOM = 'import os; data=bytearray(128*1024*1024); print(len(data))'
PIDS = r'''
import errno,json,os,signal,time
children=[];blocked=False
try:
 for i in range(64):
  try:pid=os.fork()
  except OSError as e:
   if e.errno!=errno.EAGAIN:raise
   blocked=True;break
  if pid==0:time.sleep(3);os._exit(0)
  children.append(pid)
 print(json.dumps({'resource_blocked':blocked,'owned_children':len(children)}))
finally:
 for pid in children:
  try:os.kill(pid,signal.SIGKILL)
  except ProcessLookupError:pass
 for pid in children:os.waitpid(pid,0)
'''


def docker(args, **kwargs):
    return subprocess.run(['docker', *args], check=True, timeout=45, capture_output=True, text=True, **kwargs)


def sample(image, script, budget):
    name='keyspilli-resource-'+uuid.uuid4().hex[:12]
    flags=limits(*budget)
    try:
        result=subprocess.run(['docker','run','--pull=never','--name',name,'--label','keyspilli.resource-probe=true','--network','none','--user','1000:1000','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=128m','--cap-drop','ALL','--security-opt','no-new-privileges',*flags,'--entrypoint','python3',image,'-c',script],timeout=45,capture_output=True,text=True)
        info=json.loads(docker(['inspect','--format','{"HostConfig":{{json .HostConfig}},"State":{{json .State}}}',name]).stdout)
        config=info['HostConfig'];state=info['State']
        applied={'memory_bytes':config['Memory'],'swap_total_bytes':config['MemorySwap'],'nano_cpus':config['NanoCpus'],'pids':config['PidsLimit'],'network':config['NetworkMode'],'read_only':config['ReadonlyRootfs'],'cap_drop':config['CapDrop'],'security_opt':config['SecurityOpt']}
        if applied['memory_bytes']!=budget[1]*1024**2 or applied['nano_cpus']!=int(budget[0]*1e9) or applied['pids']!=budget[2] or applied['network']!='none' or not applied['read_only']:
            raise RuntimeError('Docker did not apply requested isolated probe controls')
        payload=json.loads(result.stdout) if result.stdout.strip() else None
        return {'exit_code':state['ExitCode'],'oom_killed':state['OOMKilled'],'applied':applied,'metrics':payload}
    finally:
        removed=subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=15)
        if removed.returncode or docker(['ps','-a','--filter',f'name=^{name}$','--format','{{.ID}}']).stdout.strip():
            raise RuntimeError('Owned probe cleanup could not be verified; no successful evidence receipt was written')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--cpus',type=float,default=1)
    parser.add_argument('--memory-mib',type=int,default=384)
    parser.add_argument('--pids',type=int,default=64)
    args=parser.parse_args();limits(args.cpus,args.memory_mib,args.pids)
    output=Path(args.output)
    if output.exists():raise FileExistsError('Use a fresh evidence filename; never replace a previous measurement')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}',args.image):parser.error('Specify one existing image ID or tag')
    image=json.loads(docker(['image','inspect','--format','{"Id":"{{.Id}}","Os":"{{.Os}}","Architecture":"{{.Architecture}}"}',args.image]).stdout)
    info=json.loads(docker(['info','--format','{"Architecture":"{{.Architecture}}","MemTotal":{{.MemTotal}},"NCPU":{{.NCPU}}}']).stdout)
    if info['MemTotal']<1024**3 or args.memory_mib*1024**2>info['MemTotal']//2:parser.error('Probe ceiling needs at least twice its RAM available in the isolated Docker host')
    # ponytail: refuse concurrent containers on this isolated host; use a dedicated host for full-job budgets.
    if docker(['ps','-q']).stdout.strip():parser.error('Use an idle isolated Docker host; running containers were found')
    report={'version':1,'kind':'isolated-synthetic-decoder-probe','image_id':image['Id'],'image_platform':f"{image['Os']}/{image['Architecture']}",'docker_architecture':info['Architecture'],'docker_memory_bytes':info['MemTotal'],'docker_cpus':info['NCPU'],'cases':[],'not_measured':['full tutorial extraction','ML/stem/transcription peak','production web headroom','owner media','deployed runtime limits']}
    for duration in [3,30,90]:
        value=sample(image['Id'],f'DURATION={duration}\n'+DECODER,(args.cpus,args.memory_mib,args.pids));report['cases'].append(value)
        if value['exit_code']!=0:raise RuntimeError('Synthetic decoder hit a limit; do not infer successful job headroom')
    report['oom_probe']=sample(image['Id'],OOM,(1,64,16))
    report['pid_probe']=sample(image['Id'],PIDS,(1,64,16))
    if not report['oom_probe']['oom_killed'] or not report['pid_probe']['metrics']['resource_blocked']:raise RuntimeError('Deliberate memory/PID caps did not trigger')
    report['owned_containers_removed']=True
    output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'receipt':str(output),'decoder_cases':3,'oom_and_pid_caps_verified':True,'full_job_and_production_limits':'unmeasured'}))


if __name__=='__main__':main()
