# MVP-1 — LLM connectivity

> **Status: historical MVP record.** It documents one connectivity probe, not
> the current availability of the configured model service. Use `/api/health`
> or the project launcher for an operational health check.

Status: completed at the time of the MVP

## Objective

Verify that a minimal request reaches the configured model and returns usable text, without starting the backend, an agent, or a GMAT pipeline.

## Implementation

The script `scripts/check_chat_model_endpoint.mjs`:

- reads `chatModel` from `config.json` or the environment variables provided by the project;
- sends exactly one `POST` request to the Responses API;
- limits the response to 16 tokens;
- does not attempt `/models`, retries, or corrections;
- never displays the API key;
- returns a non-zero exit code on error.

Command from the project root, under WSL:

```bash
node scripts/check_chat_model_endpoint.mjs --json
```

An external configuration can be used temporarily without being copied:

```bash
node scripts/check_chat_model_endpoint.mjs --config /path/to/config.json --json
```

## Verifications

- four unit tests pass;
- the test counts a single request on the success path;
- the test counts a single request on the error path;
- the result does not contain the API key;
- a real probe returned `GMAT_PROBE_OK` in a single call.

The configuration used for the real probe remained local and is not versioned.

## Conclusion

The LLM connection is operational. The next MVP can build and test the deterministic rendering of the orbit-keeping template without any LLM call.
