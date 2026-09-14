# Results Calculation Contract

The Results page presents data saved in the selected mission run. It does not
start a GMAT, Simu-CIC, OPALIS, or RF-COMLINK calculation.

## GMAT mission duration

`Simulated mission duration` is a GMAT-modelled duration, not a prediction of
spacecraft operational lifetime.

For Orbit Keeping, current artifacts use `elapsedSeconds`; older artifacts may
store the same elapsed-seconds quantity under `epochA1ModJulian`. The displayed
duration is the final stored elapsed value divided by 86,400. The source is the
saved GMAT report/time series. GMAT stops when its fuel, minimum-altitude, or
configured-duration predicate is no longer satisfied.

For a Chemical Hohmann transfer, duration ends at the final propellant decrease
in the saved report, representing the solved GOI burn. Post-transfer sampling
used to create an OEM is excluded from the manoeuvre duration.

## Simu-CIC contact, eclipse, and latency

CIC scalar files are read after `META_STOP`. Their MJD/UTC timestamps are
converted to a common absolute-second representation and values apply until the
next timestamp.

For visibility or eclipse samples `v_i` at times `t_i`:

`active_duration_seconds = sum(t_(i+1) - t_i for every v_i > 0)`

Contact time uses a station visibility CIC file; eclipse time uses the satellite
eclipse CIC file. For a contact interval, station distance is interpolated over
the interval. One-way propagation latency is:

`latency_ms = distance_km / 299.792458`

The displayed latency is a contact-duration-weighted mean. Round-trip latency
is twice this value and excludes modem, routing, processing, and queueing time.
These sampled integrations are engineering summaries, not event-boundary
reconstruction.

## Evidence

Calculation details identify the source artifact. Raw GMAT, CIC, OPALIS, and
RF-COMLINK files remain authoritative. Compact files such as
`consolidated-run-report.json` and `run-analysis-context.json` are supporting
evidence for sharing and analysis, not replacements for raw outputs.
