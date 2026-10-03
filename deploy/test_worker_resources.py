import importlib.util
from pathlib import Path
import unittest
import json,subprocess,tempfile
from unittest.mock import patch
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('worker_probe',Path(__file__).with_name('measure-worker-resources.py'))
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class WorkerResourceBoundary(unittest.TestCase):
    def test_native_limits_are_bounded_without_shell_commands(self):
        self.assertEqual(probe.limits(1,384,64),['--cpus','1','--memory','384m','--memory-swap','384m','--pids-limit','64'])
        for values in [(True,384,64),(float('nan'),384,64),(.24,384,64),(33,384,64),(1,63,64),(1,True,64),(1,384,15),(1,384,4097)]:
            with self.assertRaises(ValueError):probe.limits(*values)

    def test_cleanup_failure_cannot_claim_success(self):
        state={'HostConfig':{'Memory':402653184,'MemorySwap':402653184,'NanoCpus':1000000000,'PidsLimit':64,'NetworkMode':'none','ReadonlyRootfs':True,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges']},'State':{'ExitCode':0,'OOMKilled':False}}
        with patch.object(probe,'docker',return_value=SimpleNamespace(stdout=json.dumps(state))),patch.object(probe.subprocess,'run',side_effect=[SimpleNamespace(stdout='',returncode=0),SimpleNamespace(returncode=1)]):
            with self.assertRaisesRegex(RuntimeError,'cleanup could not be verified'):probe.sample('image','print(1)',(1,384,64))

    def test_actual_budget_assertion_and_native_compose_fields(self):
        import yaml
        from jinja2 import Environment,StrictUndefined
        directory=Path(__file__).parent
        play=yaml.safe_load((directory/'playbook.yml').read_text())[0]
        task=next(t for t in play['pre_tasks'] if t['name']=='Validate optional measured worker budget')
        image='ghcr.io/example/keyspilli-worker:abcdef012345'
        budget={'image':image,'evidence_sha256':'a'*64,'full_job_headroom_verified':True,'cpus':1,'memory_mib':384,'pids':64}
        with tempfile.TemporaryDirectory(prefix='keyspilli-budget-') as scratch:
            path=Path(scratch)/'check.json'
            for configured,approved,success in [({},False,True),(budget,False,False),(budget,True,True),({**budget,'memory_mib':384.5},True,False),({**budget,'image':'ghcr.io/example/keyspilli-worker:abcdef999999'},True,False),({**budget,'full_job_headroom_verified':False},True,False)]:
                path.write_text(json.dumps([{'hosts':'localhost','gather_facts':False,'vars':{'worker_image':image,'keyspilli_worker_budget':configured,'keyspilli_worker_budget_approved':approved},'tasks':[task]}]))
                result=subprocess.run(['ansible-playbook','-i','localhost,','-c','local',str(path)],capture_output=True,text=True,timeout=30)
                self.assertEqual(result.returncode==0,success,result.stdout+result.stderr)
        env=Environment(undefined=StrictUndefined);env.filters['bool']=bool
        template=env.from_string((directory/'templates/compose.production.yml.j2').read_text())
        context=dict(docker_image='ghcr.io/example/keyspilli:abcdef012345',worker_image=image,container_name='web-fixture',worker_container_name='worker-fixture',source_search_env_file='/fixture/empty.env',app_bind_address='127.0.0.1',app_host_port=3333,app_version='a'*40,keyspilli_tutorial_beta=False)
        for configured in [{},budget]:
            parsed=yaml.safe_load(template.render(**context,keyspilli_worker_budget=configured))
            worker=parsed['services']['worker'];self.assertEqual(worker['network_mode'],'host');self.assertEqual(worker['user'],'1000:1000')
            if configured:self.assertEqual([worker['cpus'],worker['mem_limit'],worker['memswap_limit'],worker['pids_limit']],[1.0,'384m','384m',64])
            else:self.assertTrue(all(key not in worker for key in ['cpus','mem_limit','memswap_limit','pids_limit']))
        rollback=yaml.safe_load(template.render(**context,keyspilli_worker_budget=budget,compose_worker_image='keyspilli-worker:rollback'))['services']['worker']
        self.assertTrue(all(key not in rollback for key in ['cpus','mem_limit','memswap_limit','pids_limit']))

if __name__=='__main__':unittest.main()
