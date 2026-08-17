# Adding a GMAT mission template

Each template owns a directory under `workflow_agents/gmat_skills/<template-id>-template`.
Its `template.json` is the backend source of truth for its identity, digital-thread
request key, draft directory, reference files, satellite requirements, and downstream
analyses. The server validates every declared reference script during tests.

To add a template:

1. Create the skill directory with `template.json` and immutable GMAT references.
2. Add the ID to `GMAT_TEMPLATE_IDS` in `src/gmat/templateRegistry.ts`. This is the
   compile-time allow-list for exposed API routes.
3. Implement one `MissionTemplateRuntime` adapter in `src/gmat/missionTemplateRuntime.ts`.
   It translates the common lifecycle (`create`, `discuss`, `confirm`, `execute`,
   `recordRun`) to the template engineering code.
4. Add the digital-thread mapping in `gmatDigitalThreadAdapter.ts`, including explicit
   guards for incompatible satellite propulsion or missing physical inputs.
5. Add presentation fields to the frontend template registry. The Mission Studio and
   workflow UI already use that registry, so no template-specific page should be added.
6. Add a registry test and a generator/draft test. Run `npm run test:gmat:baseline` and
   execute one real GMAT scenario before considering the template approved.

The shared HTTP lifecycle is already available at `/api/gmat/templates/:template/...`.
Do not add a new set of per-template HTTP routes unless the scenario has a genuinely
different external integration.
