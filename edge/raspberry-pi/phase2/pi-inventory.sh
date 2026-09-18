#!/bin/sh
# Read-only baseline. Deliberately never print environment files or API keys.
set -u
printf 'System: '
uname -sm
python3 --version
for unit in digitalnose.service digitalnose-aggregator.service digitalnose-sync.service; do
    printf '\n%s\n' "$unit"
    systemctl show "$unit" --property=ActiveState,SubState,User,Group,FragmentPath,WorkingDirectory,Restart --no-pager
 done
printf '\nI2C devices (no bus scan):\n'
ls -l /dev/i2c-* 2>/dev/null || true
printf '\nTime synchronization:\n'
timedatectl show --property=NTPSynchronized --property=Timezone
printf '\nDeployment account and free disk:\n'
id diginose
df -h /home/diginose/digital-nose
printf '\nIsolated Phase II environment, if installed:\n'
if [ -x /home/diginose/digital-nose/.venv-phase2/bin/python ]; then
    /home/diginose/digital-nose/.venv-phase2/bin/python --version
    /home/diginose/digital-nose/.venv-phase2/bin/python -m pip list --format=columns
fi
