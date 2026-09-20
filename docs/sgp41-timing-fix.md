# SGP41 timing/state correction — 20 September 2026

Local implementation only. No Pi, Supabase, production configuration, observation or deployment was changed during this work.

## Cause and duration interpretation

`collect()` schedules nominal one-second slots using a monotonic `due` time. It skips slots when a completed acquisition has overrun the next deadline. It does not guarantee one second between actual sensor commands: different MUX waits within adjacent slots change their spacing. Each BME holds the shared lock during its forced conversion, including the existing 250ms wait. Two BME workers can therefore introduce several hundred milliseconds of SGP41 jitter without a bus fault. Publishers have separate processes and do not take the MUX lock; CPU/disk scheduling and SQLite contention can still delay acquisition.

Previously, SGP41 timestamped entry into the adapter (after the MUX wait) and raised `RuntimeError` below 0.9 seconds. `Acquisition.step()` interpreted that exception as a sensor error, persisted it, and closed `Hardware`, which discarded the adapter. The next call initialized a new adapter and restarted conditioning. This happens inside one continuously running systemd process and does not increment `NRestarts`. The separate gap-above-two-seconds branch also unnecessarily switched the heater off and reset conditioning.

`duration_ms` measures the whole `Hardware.read()` plus payload validation, including lock waits, initialization, conversion, and error-close handling. It is not the interval between consecutive commands; persistence happens after this duration is logged.

An original-code simulation reproduced both reported durations: acquisition at t=0 waits 365ms for the MUX, dispatches at t=0.365 and completes a 50ms conversion at t=0.415 (415ms). The next nominal slot at t=1 waits 103ms and reaches the adapter at t=1.103. Its interval is only 738ms, so the old guard raises before conversion; with immediate close/deselection, duration is 103ms. This demonstrates a compatible causal mechanism, not proof of the exact lock timings in production. The logger does not separately measure lock wait and command start.

## Timing and state after the patch

- The existing acquisition scheduler still owns nominal 1Hz cadence. No scheduling, persistence or publishing code changes.
- `last_command_at` records the monotonic timestamp immediately before invoking `conditioning()` or `measure_raw()`, after waiting and compensation lookup. It describes a command-dispatch attempt, not adapter entry or successful readout completion. A failed I2C call may already have written the command, so the timestamp is retained even on failure.
- Early calls wait until `last_command_at + 1.0`, rechecking after waking. This enforces the selected conservative one-second spacing rather than raising a synthetic hardware error or issuing catch-up commands.
- For an initialized SGP41, `Hardware.read()` waits before selecting the MUX. The adapter checks again under the existing complete-operation lock. Direct adapter calls also receive the spacing guard. Selection, command, conversion, response and deselection retain their existing lock scope.
- No interval length alone calls `heater_off()` or resets `started`/`count`. Initialization and actual close/recovery retain heater-off behavior. Genuine I2C/CRC exceptions still propagate to the unchanged acquisition error/persistence path. Real storage backpressure retains its existing close/resume policy.
- Initial conditioning retains manufacturer-default 25°C/50%RH inputs, VOC-only warm-up observations, and the elapsed ten-second window anchored to the first conditioning dispatch. At exact cadence, commands occur at 0 through 9 seconds and the paired raw command at 10 seconds. Missed slots do not cause additional conditioning to make up a count. The next eligible call at/after ten seconds transitions to raw operation. No derived indices are introduced.

The [Sensirion datasheet](https://sensirion.com/media/documents/5FE8673C/61E96F50/Sensirion_Gas_Sensors_Datasheet_SGP41.pdf), sections 3.1–3.2, requires conditioning after restart/heater-off, recommends continuous operation and nominal one-second sampling, and gives a ten-second maximum conditioning duration. Its raw-sampling specification allows 0.5–10 seconds; the one-second guard here is the chosen operating policy, not a claim that all subsecond calls violate the silicon specification. Linux scheduling and MUX delays cannot guarantee a hard physical ten-second transition under arbitrary stalls; the adapter must never deliberately restart/extend conditioning to make up missed samples. This existing real-time limitation still needs physical validation.

The released `adafruit-circuitpython-sgp41==1.0.2` wheel was inspected in memory (SHA-256 `4a061698271203138604572121767cf20948522263e7fba140fe5ad81c51f921`). Its paired raw and conditioning methods dispatch a command, wait for conversion, and read the response. A real CRC failure can also raise `RuntimeError`; the patch removes only our timing-generated exception, not vendor exceptions.

## Validation

`python3 -m unittest discover -s edge/raspberry-pi -p 'test_*.py'`: 51 passed, including 37 Phase II tests. `node --import tsx --test tests/sensor-*.test.ts tests/sensor-*.test.tsx`: 15 passed, including Phase I preservation and Python-to-API contract validation.

Coverage includes exact 1.0-second cadence, jitter, immediate/early calls, early sleep wakeup, gaps above two seconds during conditioning and normal operation, default conditioning inputs, the ten-second transition, command timestamps after compensation, real OSError/CRC RuntimeError persistence, waiting outside the MUX lock while commands stay inside it, and 240 acquisitions over several simulated minutes using the actual `collect()` loop with varying MUX waits and two 3.25-second host/persistence stalls. That simulation has no artificial error or reconditioning. Shutdown still closes the heater.

BME690, SPS30 and ENS160 adapters are unchanged from the start of this fix. `runtime.py`, `bus.py`, outbox, publisher and production schema are unchanged. Existing error records require no cleanup: keep them as invalid diagnostic evidence. Valid-only charts exclude them independently of maintenance; maintenance additionally excludes affected chart periods. Do not rewrite their status or retry identities.

## Later Pi deployment and validation (not executed)

Only `drivers.py` needs deployment. From the Mac:

```sh
scp edge/raspberry-pi/phase2/drivers.py \
  diginose@PI_HOST:/home/diginose/digital-nose/phase2/drivers.py.new
ssh diginose@PI_HOST
```

On the Pi, use a subshell so any failed command stops the update:

```sh
(
set -eu
cd /home/diginose/digital-nose
.venv-phase2/bin/python -c "import ast; ast.parse(open('phase2/drivers.py.new').read())"
sudo systemctl stop digitalnose-sensor-acquire@sgp41_01.service
cp -p phase2/drivers.py "phase2/drivers.py.backup.$(date +%Y%m%dT%H%M%S)"
chmod --reference=phase2/drivers.py phase2/drivers.py.new
mv phase2/drivers.py.new phase2/drivers.py
validation_since=$(date --iso-8601=seconds)
sudo systemctl start digitalnose-sensor-acquire@sgp41_01.service
sleep 300
sudo systemctl show digitalnose-sensor-acquire@sgp41_01.service \
  -p ActiveState -p SubState -p NRestarts
sudo journalctl -u digitalnose-sensor-acquire@sgp41_01.service \
  --since "$validation_since" --no-pager -o cat
)
```

Expect one initial warm-up followed by sustained `ok`/`valid=true` observations on CH3; no timing-generated RuntimeError or renewed warm-up after reaching `ok`. Investigate any genuine errors; do not filter them away. Confirm BME/SPS workers remain healthy. This later procedure restarts only SGP41 acquisition and leaves existing publishing, maintenance, config and queue data untouched. Existing active publishers will naturally deliver real acquired observations; no test observations are injected. A hardware diagnostic must not run concurrently with acquisition.
