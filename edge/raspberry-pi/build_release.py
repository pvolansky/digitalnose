"""Build a Phase I-only artifact from an explicit committed Git revision."""
import argparse
import hashlib
import io
import json
import subprocess
import tarfile
from pathlib import Path

FILES=('database.py','sensor.py','collector.py','aggregator.py','sync.py','requirements.txt',
       'digitalnose.service','digitalnose-aggregator.service','digitalnose-sync.service')

def build(revision,output):
    commit=subprocess.check_output(['git','rev-parse',revision+'^{commit}'],text=True).strip()
    prefix='edge/raspberry-pi/'
    contents={name:subprocess.check_output(['git','show',f'{commit}:{prefix}{name}']) for name in FILES}
    hashes={name:hashlib.sha256(body).hexdigest() for name,body in contents.items()}
    contents['MANIFEST.json']=(json.dumps({'git_commit':commit,'schema_version':1,'files':hashes},sort_keys=True,indent=2)+'\n').encode()
    contents['SHA256SUMS']=''.join(f'{hashlib.sha256(body).hexdigest()}  {name}\n' for name,body in sorted(contents.items())).encode()
    with tarfile.open(output,'w',format=tarfile.USTAR_FORMAT) as archive:
        for name,body in sorted(contents.items()):
            info=tarfile.TarInfo(f'phase1-{commit}/{name}')
            info.size=len(body);info.mode=0o644;info.mtime=0
            archive.addfile(info,io.BytesIO(body))
    return commit

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--commit',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(build(args.commit,args.output))
