# Results calculation contract

The Results page only presents data saved in the selected mission run. It does not start a new GMAT, Simu-CIC, OPALIS, or RF-COMLINK calculation.

## GMAT simulated mission duration

`Simulated mission duration` is a modelled GMAT duration, not a prediction of the spacecraft's operational lifetime.

For Orbit Keeping, the value is the span of `orbit_timeseries.json`:

`duration_days = final_epoch_A1ModJulian - initial_epoch_A1ModJulian`

GMAT stops its orbit-keeping loop when one or more loop predicates is no longer true: enough propellant for a safe reboost, altitude above the minimum reboost altitude, and elapsed days below the configured duration limit. The Results page displays this predicate and the final saved GMAT state. `OrbitAnalysisReport.txt` is the source artifact.

For Chemical 2D Transfer, the value is the elapsed time at the final propellant decrease in `ReportFile1.txt`. This is the solved GOI burn. The post-transfer propagation samples used to create the OEM are deliberately excluded.

## Simu-CIC contact, eclipse, and latency

Each CIC scalar file is parsed after `META_STOP`. Its MJD/UTC timestamps are
converted to a common absolute-second representation; only their differences
are used. A scalar value applies to the interval until the next timestamp.

For visibility or eclipse samples `v_i` at times `t_i`:

`active_duration_seconds = sum(t_(i+1) - t_i for every v_i > 0)`

Contact time uses a ground-station visibility CIC file. Eclipse time uses the satellite eclipse CIC file.

For every contact interval, the ground-station distance is linearly
interpolated over the interval. One-way propagation latency is then:

`latency_ms = distance_km / 299.792458`

The displayed one-way latency is the contact-duration-weighted mean; the
distance integration is trapezoidal between CIC samples. Round-trip latency is
twice that value. It excludes modem, routing, processing, and queueing delays.

An eclipse sample above `0%` counts as eclipsed, so the displayed eclipse time
includes penumbra. These sampled integrations are engineering summaries, not
event-boundary reconstruction.

## Evidence

The source field shown in Calculation details identifies the saved artifact. The raw artifact is available in Results under Generated files. `consolidated-run-report.json` and `run-analysis-context.json` carry compact, structured evidence for sharing and analysis; the raw GMAT, CIC, OPALIS, and RF-COMLINK files remain authoritative.
