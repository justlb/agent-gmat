import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { renderGmatTemplate, renderPropagation } from "../../src/gmat/declarativeScenarioEngine.js"

describe("declarative GMAT renderer", () => {
  it("updates an Achieve target without changing its quoted command name", () => {
    const source = "   Achieve 'Achieve ECC = 0.005' DC1(DefaultSC.Earth.ECC = 0.005, {Tolerance = 0.0001});\n"
    const rendered = renderGmatTemplate(source, { "targetOrbit.eccentricity": 0 }, [{
      path: "targetOrbit.eccentricity",
      properties: ["DefaultSC.Earth.ECC"],
      required: true,
    }])
    assert.equal(rendered, "   Achieve 'Achieve ECC = 0.005' DC1(DefaultSC.Earth.ECC = 0, {Tolerance = 0.0001});\n")
  })

  it("replaces a complete PointMasses list without retaining the old comma suffix", () => {
    const source = [
      "AllForces.PointMasses = {Sun, Luna};",
      "AllForces.Drag = None;",
      "AllForces.RelativisticCorrection = On;",
    ].join("\n")
    const rendered = renderPropagation(source, {
      "propagation.includeSun": false,
      "propagation.includeLuna": true,
      "propagation.atmosphereModel": "None",
      "propagation.relativisticCorrection": false,
    }, "AllForces", [])
    assert.match(rendered, /^AllForces\.PointMasses = \{Luna\};$/mu)
    assert.doesNotMatch(rendered, /\}\s*,\s*Luna\}/u)
  })
})
