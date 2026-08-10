import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseMissionRoutingDecision } from "../../src/gmat/missionRouter.routes.js"

describe("GMAT mission router", () => {
  it("accepts each supported routing decision", () => {
    assert.deepEqual(
      parseMissionRoutingDecision('```json\n{"target":"orbit-keeping","message":"I will prepare an orbit-keeping draft."}\n```'),
      { target: "orbit-keeping", message: "I will prepare an orbit-keeping draft." },
    )
    assert.deepEqual(
      parseMissionRoutingDecision('{"target":"clarify","message":"Do you need station keeping or an electric transfer?"}'),
      { target: "clarify", message: "Do you need station keeping or an electric transfer?" },
    )
  })

  it("rejects malformed or unsupported LLM output", () => {
    assert.throws(() => parseMissionRoutingDecision("not json"), /valid JSON/u)
    assert.throws(() => parseMissionRoutingDecision('{"target":"chemical-transfer","message":"x"}'), /unknown target/u)
  })
})
