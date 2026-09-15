# Known Issues and Verification Backlog

This document records defects, probable defects, and engineering checks that
must be completed before treating the application as operationally robust.
Items labelled **to verify** are evidence-based suspicions from code review;
they are not confirmed failures until reproduced with a saved GMAT run.

## Launch and configuration

| Priority | Status | Issue | Required correction / verification |
| --- | --- | --- | --- |
| High | Confirmed | The launcher still requires a complete AI model configuration. A project without API key, endpoint, and model does not currently start as the tutorials previously claimed. | Either keep this requirement explicit in the tutorials, or complete and publish the no-AI startup path. |
| Medium | To verify | Configuration validation and runtime validation can diverge as optional services evolve. | Add automated configuration fixtures for AI enabled/disabled and every optional scientific tool. |

## GMAT scripts and mission parameters

| Priority | Status | Issue | Required correction / verification |
| --- | --- | --- | --- |
| High | Confirmed | The reference scripts are known to work mainly with their embedded baseline values. Their parameter space has not been demonstrated by a systematic GMAT campaign. | Run a boundary and nominal-value matrix for every maintained template; retain generated script, GMAT log, OEM, and report as evidence. |
| High | Confirmed | `chemical-hohmann-transfer` exposes `transfer.finalPropagationSeconds`, defaults it to `86400`, renders it into `DefaultSC.ElapsedSecs`, and contains `Propagate 'Prop One Day'`. This adds a post-transfer output propagation rather than mission manoeuvre time. | Remove the field, default, renderer replacement, and final propagation command; preserve OEM generation using a mission-derived output interval if it is still needed. |
| High | To verify | Some UI fields marked optional may not affect the final GMAT script for every template. | Create a parameter-to-script coverage test for every `ui.mission_input_fields` path: change one value, render, and assert the intended GMAT assignment changes exactly once. |
| High | To verify | Optional values can silently retain a reference-script default, which may look like an engineer decision in a report. | Mark every default in generated values and Results as `template default`, `satellite value`, or `engineer input`. |
| Medium | To verify | Template-specific generation is uneven: the electrical LEO service explicitly replaces mission duration and throttle values, while other optional fields rely on draft-slot rebinding. | Test every optional field for electrical LEO, chemical Hohmann, electric transfer, and orbit keeping against the rendered script and a GMAT run. |
| Medium | To verify | Report time columns are not uniform across scripts (`ElapsedSecs` and `ElapsedDays` are both used). | Define one parser contract per template and test the displayed units and duration calculation against known reports. |
| Medium | To verify | Reference scripts under `mission scenario to implement/` are not registered maintained scenarios. | Keep them clearly isolated, or promote each only after a manifest, adapter, renderer, tests, and end-to-end run exist. |

## GUI access

GMAT, Simu-CIC, OPALIS, and RF-COMLINK GUI actions already exist in the
application. The current frontend provides buttons to open the active run in
the relevant GUI, and backend routes already open GMAT for the orbit-keeping
and electric-transfer flows. Adding equivalent buttons for a newly maintained
scenario should reuse these established route/API/button patterns rather than
create a new GUI architecture.

Before enabling a new button, verify that it opens the **run-local generated
artifact**, not the immutable reference script or a shared example file.

## Required test strategy

For each maintained GMAT template, add automated checks for:

1. baseline rendering matches the declared reference values;
2. every required input changes the expected GMAT assignment;
3. every optional input either changes an assignment or is removed from the UI;
4. invalid values are rejected before GMAT starts;
5. a nominal run and boundary runs produce a report and non-empty OEM;
6. the GUI action opens the generated run-local script;
7. downstream Simu-CIC receives the OEM from the same run.

## Rules for closing an issue

Do not close an item based only on a successful build, a screenshot, or a
single baseline run. Close it only with a focused automated test and, where
GMAT semantics are involved, a retained execution artifact that demonstrates
the expected physical and unit behaviour.
