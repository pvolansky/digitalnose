# Future incremental hardware bring-up

Software preparation does not establish hardware readiness. BME690/SGP41 are available but unconnected; SPS30 is ordered. No step below has been performed by this implementation.

1. Review the local Phase II changes, database migration history and a database backup. Obtain permission before pushing/deploying/applying production migrations.
2. Apply reviewed migrations before enabling the new endpoint/dashboard. Confirm the intended collector has five registry entries and no fabricated new observations.
3. Confirm ENS160 telemetry, smell reports, window/presence/maintenance and weather operate normally as the baseline.
4. Power the Raspberry Pi OFF.
5. Connect DFRobot DFR0566 HAT → Gravity/Qwiic cable → the TCA9548A main/input port, using board vendor wiring/voltage guidance.
6. Boot the Pi. Verify mux detection at its configured address (normally 0x70; solder address settings can change it).
7. Verify ENS160 continues working before adding downstream sensors.
8. Power OFF.
9. Connect BME690 #1 on CH0, or update the registry if a different planned channel is used.
10. Boot and verify mux channel selection, sensor identity/address and independent sensor detection.
11. Implement/enable its low-level adapter; verify gas resistance, temperature, humidity, pressure and actual available validity flags. Normalize pressure to Pa and gas resistance to Ω. Preserve optional heater metadata only where exposed/known.
12. Configure acquisition and an independent durable outbox. Preserve original UTC timestamps and a stable retry sequence. Use the existing collector credential for the versioned per-sensor endpoint.
13. Verify genuine BME690 #1 observations arrive in the database and exactly retried observations do not duplicate.
14. Confirm AWAITING DATA transitions to WARMING UP or LIVE only from acquisition evidence; verify its chart and original timestamps in inspection.
15. Power OFF.
16. Connect BME690 #2 on a different mux channel, initially CH1.
17. Boot and verify both sensors independently. Select one downstream mux channel at a time when addresses are identical; confirm no address conflicts or concurrent mux-selection races.
18. Give BME690 #2 its own sensor key, acquisition state and outbox stream. Never merge the two sensors' observations.
19. Verify separately identifiable database rows, both chart series, toggles and independent failure/recovery.
20. Power OFF.
21. Connect SGP41 on another channel, initially CH2.
22. Boot and verify sensor detection, raw VOC/NOx, conditioning and compensation inputs against the official driver/interface.
23. Preserve raw tick signals; do not substitute VOC/NOx indices. Record conditioning with invalid-for-analysis state, and allow absent NOx during conditioning.
24. Verify independent ingestion and automatic WARMING UP/LIVE transitions. Simulate an acquisition failure in a controlled manner and verify ENS160 and both BME streams continue.
25. When SEK-SPS30 arrives, inspect its supplied USB interface/adapter and verify USB enumeration before enabling any acquisition. The sensor itself exposes UART/I²C; use the evaluation kit's actual USB bridge/interface.
26. Enable an appropriate official low-level interface for that adapter; verify PM1/2.5/4/10 in µg/m³, number concentrations in particles/cm³, typical size and status/error flags where exposed.
27. Verify number fields refer to cumulative 0.3 µm–upper-size ranges, not counts above a threshold.
28. Enable its independent outbox and verify genuine telemetry arrives. Confirm SPS30 leaves AWAITING DATA only after real acquisition evidence.
29. Verify PM chart toggles, missing-data gaps, particle details and cross-sensor original timestamps.
30. Run the complete array simultaneously. Verify ENS160, window tracking, occupancy, smell reporting, maintenance and weather remain unaffected.
31. Check NTP/time synchronization, observed versus received times, latency, reboot behavior, key revocation/rotation and offline retry recovery.
32. Inspect I²C/mux/USB errors, resets, missing/dropped readings, stale status, memory growth, CPU use and database ingestion/query errors during a continuous soak period.
33. Measure real rows/day, row/index sizes and week-window query plans; adjust validated cadences and infrastructure capacity without silently deleting raw data.
34. Record baseline behavior, sensor-to-sensor agreement, heater/profile provenance, noise, drift, environmental and ventilation effects. Establish data quality before training SSM.
35. For future modeling, build event/day/time-period validation splits and sensor ablation datasets. Do not randomly split correlated rows from the same physical event.

Bring sensors online one at a time. Do not connect the entire new array as the first hardware test.
