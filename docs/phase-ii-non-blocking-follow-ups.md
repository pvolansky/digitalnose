# Phase II non-blocking follow-ups

## Transient SQLite contention and several-second sampling gaps

Status: non-blocking follow-up; Phase II commissioning accepted by the operator on 20 September 2026. This is not an unresolved commissioning failure.

Operator-provided final reboot forensics identified transient SQLITE_BUSY contention as the cause of the approximately 6–7 second shared sampling pause. The hardened lifecycle retained pending observations and their original timestamps, did not recreate healthy drivers, and produced no post-steady-state warming-up/invalid/error relapse. SGP41 had no RuntimeError/TimeoutError; SPS30 had no SerialException. All four acquisition services remained active with NRestarts=0, and the operator reported no kernel hardware errors or throttling.

The production-only acceptance watch independently confirmed contiguous sequences, healthy post-conditioning observations, correct MUX channels and SGP41 compensation, and sustained healthy streams through 16:18:55 UTC. It did not itself inspect SQLite or host logs; the SQLITE_BUSY attribution comes from the operator's subsequent forensics.

Follow-up scope: characterize lock ownership and commit/acknowledgement timing during startup, then evaluate ways to reduce occasional acquisition pauses without weakening FULL durability, changing sequence identity, dropping pending observations, or coupling storage retry to hardware recovery. Any future deployment is a separate task. Preserve commissioning records and historical observations.

The operator explicitly approved ending maintenance after commissioning passed. Production maintenance was changed ON to OFF by appending the normal state event at 2026-09-20T16:22:02.090194Z. Historical maintenance events were not edited. Normal chart eligibility begins with the next wholly non-maintenance minute, 16:23 UTC, under the existing minute-overlap rule.
