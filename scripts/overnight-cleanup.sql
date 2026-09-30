-- Executed with user approval on 2026-09-24 against production.
-- Total removed: 402950 observations. Final per-sensor overnight counts: all zero.
-- Recent observations continued advancing for all four sensors after cleanup.
-- This is a one-off historical cleanup, not a scheduled retention policy.
-- Existing history, midnight inclusive to 08:00 exclusive, Europe/London.
-- Repeat this bounded statement until deleted_rows = 0, then recount.
WITH candidates AS (
  SELECT o.id
  FROM public.sensor_observations o
  JOIN public.sensors s ON s.id = o.sensor_id
  WHERE s.device_id = 'c504559d-bc47-4d88-9fdd-ed12326bfb38'
    AND s.sensor_key IN ('bme690_01', 'bme690_02', 'sgp41_01', 'sps30_01')
    AND o.observed_at < timestamptz '2026-09-25 00:00:00 Europe/London'
    AND (o.observed_at AT TIME ZONE 'Europe/London')::time < time '08:00'
  LIMIT 5000
), deleted AS (
  DELETE FROM public.sensor_observations o
  USING candidates c
  WHERE o.id = c.id
  RETURNING o.id
)
SELECT count(*) AS deleted_rows FROM deleted;
