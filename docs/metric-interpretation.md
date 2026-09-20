# Sensor metric information

The central typed catalogue is `lib/sensors/metric-info.ts`. Charts and summary icons use the existing MetricInfo/InfoTooltip component. Weather, ingestion, database schema and edge software are outside this change.

## Displayed inventory

| Sensor | Metrics | Units | Interpretation class |
|---|---|---|---|
| ENS160 | TVOC; eCO₂; AQI | ppb; ppm; index /5 | Manufacturer-derived estimates/index |
| BME690 | Gas resistance | Ω | Relative raw response; no absolute quality bands |
| BME690 | Temperature; relative humidity; pressure | °C; %RH; hPa | Environmental context |
| SGP41 | Raw VOC; raw NOx | ticks | Logarithmic electrical signals; no health categories |
| SPS30 | PM1.0; PM2.5; PM4; PM10 | µg/m³ | Optical mass estimates |

Prepared only: SPS30 five cumulative particle-number fractions (particles/cm³), typical particle size (µm), SGP41 compensation inputs and future VOC/NOx indices. No new charts or derived streams are created.

## Source register

- ScioSense ENS160: https://www.sciosense.com/wp-content/uploads/2023/12/ENS160-Datasheet.pdf
- Bosch BME690: https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme690-ds001.pdf
- Sensirion SGP41: https://sensirion.com/media/documents/5FE8673C/61E96F50/Sensirion_Gas_Sensors_Datasheet_SGP41.pdf
- Sensirion gas-index interpretation: https://sensirion.com/media/documents/ACD82D45/6294DFC0/Info_Note_Integration_VOC_NOx_Sensor.pdf
- Sensirion SPS30: https://sensirion.com/file/datasheet_sps30
- WHO 2021 guideline table: https://www.ncbi.nlm.nih.gov/books/NBK574582/table/fm-ch1.tab1/
- UK DAQI: https://www.gov.uk/government/publications/health-effects-of-air-pollution/pollutant-concentrations-for-the-daily-air-quality-index-daqi

## Scientific boundaries

SGP41 ticks are proportional to logarithmic sensing-layer resistance. 13,600, 15,000 and 30,000 are not concentrations or quality classes. Under manufacturer test conditions ethanol increases lower VOC ticks; NO₂ increases raise NOx ticks. Mixed gases, conditioning and compensation prevent universal conversion. NOx is also sensitive to other oxidizing gases.

BME690 resistance must be compared within a sensor and heater configuration, considering environmental changes. No universal green/amber/red resistance bands exist in this UI. No baseline deviation classification is invented.

WHO PM2.5/PM10 24-hour guideline values are 15/45 µg/m³. These are not instantaneous alarm limits or a complete set of quality categories; the WHO short-term guideline uses a 99th-percentile convention (approximately 3–4 exceedance days/year). UK particulate DAQI also uses a daily/rolling 24-hour mean. Latest PM values therefore have a neutral “Recent concentration” badge. No exposure assessment is calculated. SPS30 cumulative fractions overlap and must not be summed.

ENS160 eCO₂/AQI badge boundaries remain unchanged and attributed to ScioSense. eCO₂ is not directly measured CO₂. No single sensor identifies a chemical, cooking oil, restaurant or health hazard.

## Interaction

All information is non-interactive tooltip content: Measures, Interpretation and Digital Nose, with limitations in the last section. Source links stay here and in catalogue metadata, so no link focus trap is introduced. Hover/focus/tap opens; Escape, outside pointer and blur dismiss. Actual rendered dimensions constrain positioning; a ResizeObserver and scroll listener keep the panel inside the viewport. Existing typography, colours and 300px panel width are retained.

## Interaction regression checklist

Verified locally at desktop size and a 375 × 667 viewport:

- Open Raw VOC information using the labelled button; the panel remains open while its trigger has focus, including after pointer departure.
- Confirm the rendered panel fits inside the viewport (measured mobile bounds: x=59, y=292.67, width=300, height=358.33).
- Escape closes the panel with focus retained on its trigger; Enter reopens it.
- Tab closes the panel and advances focus; no focus trap.
- Clicking the chart heading outside the panel dismisses it.
- PM series toggles and information buttons are siblings, never nested controls.

Automated tests cover catalogue completeness, raw-unit/category restrictions, time-averaged PM provenance, preserved ENS160 boundaries and measured-panel positioning for narrow/short viewports. Physical-device touch testing remains a release QA follow-up; outside-pointer dismissal uses the same handler for mouse and touch.

BME690 pressure is displayed in hPa (stored Pa divided by 100); acquisition and storage remain in Pa.
