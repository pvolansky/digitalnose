# Phase II acquisition plan

1. Audit the existing reference collector and verify official sensor APIs. Preserve all legacy ENS160 files and the Phase II API/database contract.
2. Add isolated sensor adapters, centrally locked mux access and disabled-by-default hardware configuration. Keep ENS160 on its existing service path.
3. Add per-sensor SQLite sequence/outbox storage and independent acquisition/upload services. Preserve exact request bytes across retries; quarantine conflicts.
4. Add hardware-free conversion, queue, transport, lifecycle, isolation and contract-compatibility tests.
5. Add one-device-only diagnostics and a 20-point handover with exact installation/bring-up commands and limitations.

No push, production fixture insertion, remote deployment, Pi package installation, service enablement or physical hardware test is authorized by this preparation step. New services ship disabled. Actual Pi inventory is recorded in the handover; installation and hardware validation remain pending.

## Execution results

All five preparation stages are complete in the isolated local workspace. Added lazy vendor adapters, one-hot mux locking, per-sensor acquisition/upload services, exact-byte durable queues, disabled defaults, nonpublishing diagnostics and a 20-point handover in `docs/phase-ii-acquisition.md`.

Validation: 32 Python tests (29 new plus 3 unchanged legacy), 69 Node tests, lint/typecheck, production webpack build, Python compilation/config checks and temporary-venv vendor imports/dependency checks. The 58-file Phase I preservation fingerprint test still passes. No Phase II API/database contract changes were needed.

Pending physical gates: recheck the supplied Pi runtime/service baseline, install into an isolated venv, test ENS160 baseline then mux only, add BME #1, BME #2, SGP41 and later SPS30 individually, verify approved public endpoint deployment before enabling publishing, then perform the full-array soak. No hardware-readiness claim is made.
