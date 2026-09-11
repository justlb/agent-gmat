# Slides Guide — What to Put on Each Slide

> One slide per paragraph of the script. Minimal text on slides, the script carries the speech.

---

## Slide 1: Title

**Content:**
- Title: "Integrate the IDM Satellite Engineering Library into the Laboratory Design Process"
- Name: Justine Le Bourg
- UTBM — Shanghai University (dual degree)
- Host: Key Lab for Satellite Digitalisation Technology, IAMCAS, CAS
- Supervisor: Dr. Farid Gamgami
- Date: [defense date]

**Visual:** Logo UTBM + logo IAMCAS side by side. Clean title slide, no diagram.

---

## Slide 2: Outline

**Content:**
- Numbered list, one line each:
  1. Context & Company
  2. Problem & Objectives
  3. Methodology
  4. Technical Achievements
  5. Validation & Limitations
  6. Assessment & Perspectives

**Visual:** Simple numbered list, large font. No diagram.

---

## Slide 3: Context & Company

**Content (bullet points):**
- IAMCAS — 105 satellites launched, 700+ staff, 88% postgrad/PhD
- Key Lab: digital consistency across satellite lifecycle
- APSL team: introducing concurrent engineering in China
- Goal: AI-boosted digital thread for concurrent engineering sessions
- My role: build the reliable computation building block

**Visual — Org chart:**

```mermaid
graph TD
    A["Chinese Academy of Sciences"] --> B["IAMCAS<br/>Innovation Academy for Microsatellites<br/>105 satellites · 700+ staff"]
    B --> C["Key Lab for Satellite<br/>Digitalisation Technology"]
    C --> D["APSL Team<br/>Concurrent Engineering + AI"]
    D --> E["My project<br/>Reliable computation tool"]
```

**Tip:** Keep missions (QUESS, DAMPE, SMILE) as small icons or a strip below.

---

## Slide 4: Problem & Objectives

**Content:**
- Research question (centered, larger font):
  > "How to integrate the IDM library into the design process to make preliminary studies faster, more consistent and fully traceable?"

- 4 objectives as a 2x2 grid or numbered list:
  1. Interconnect tools
  2. Automate the chain
  3. Guarantee traceability
  4. Prepare AI integration

**Visual — Objectives diagram:**

```mermaid
graph LR
    O1["1. Interconnect<br/>tools"] --> O4["4. Prepare<br/>AI integration"]
    O2["2. Automate<br/>the chain"] --> O3["3. Guarantee<br/>traceability"]
    O4 --- O3
```

---

## Slide 5: Methodology — 4 Phases

**Content:** Minimal — just the 4 phase names as a timeline.

**Visual — Timeline:**

```mermaid
graph LR
    P1["Phase 1<br/>Inventory<br/>54 tools surveyed<br/>4 selected"] --> P2["Phase 2<br/>Proofs of concept<br/>Python scripts<br/>Data continuity proven"]
    P2 --> P3["Phase 3<br/>AI tool calling<br/>Tested & abandoned<br/>Too unstructured"]
    P3 --> P4["Phase 4<br/>Demonstrator<br/>Deterministic pipeline<br/>Frontend as design tool"]
```

**Tip:** Color Phase 3 in red/orange (pivot/abandonment), Phase 4 in green (solution). One sentence per phase max on the slide.

---

## Slide 6a: Demonstrator Overview

**Content:**
- Name: Open Codex Web (full-stack, TypeScript)
- Based on existing project (ChatGPT-generated, adapted)
- One click → full analysis pipeline
- Output: timestamped, traceable directory

**Visual — Pipeline flow (key diagram of the presentation):**

```mermaid
graph LR
    UI["Mission Config<br/>satellite + orbit params"] --> GMAT["GMAT<br/>orbit propagation"]
    GMAT -->|"ephemeris"| SIMU["Simu-CIC<br/>attitude · eclipses<br/>ground contact"]
    SIMU -->|"enriched data"| OPALIS["OPALIS<br/>electrical system"]
    SIMU -->|"ground contact times"| RF["RF-COMLINK<br/>telecommunications"]
    OPALIS --> OUT["Timestamped<br/>traceable directory"]
    RF --> OUT
```

**Tip:** This is the most important diagram — make it large. Show parallel branches (OPALIS + RF-COMLINK) clearly.

---

## Slide 6b: Digital Thread & GMAT Templates

**Content (two columns):**

**Left — Satellite/Mission separation:**
- Satellite = reference data (immutable)
- Mission = study data (volatile)
- Each value carries provenance

**Right — GMAT template system:**
- Auto-extract modifiable values
- Anti-injection validation
- Catalog of validated scripts (80% coverage)
- LLM generation abandoned (unreliable, security risk)

**Visual — Digital thread provenance:**

```mermaid
graph TD
    SAT["Satellite Library<br/>mass · surfaces · electrical<br/>source: satellite_library"] --> DRAFT["Mission Draft<br/>altitude · propulsion · stations<br/>source: gmat_mission_draft"]
    DRAFT --> CALC["GMAT computation<br/>ephemeris · eclipses · RF margins<br/>source: gmat_computed"]
    CALC --> MANIFEST["run_manifest.json<br/>SHA256 · revision · provenance"]
```

**Tip:** Use the provenance tags (`satellite_library`, `gmat_mission_draft`) as visible labels on arrows.

---

## Slide 6c: Results Page

**Content:**
- Runs list (filter by status/scenario)
- Single-run: metrics + time series + bar charts
- Multi-run (up to 5): overlay curves + unified comparison table
- AI assistant: disciplined prompt, evidence-based

**Visual — Results page mockup (wireframe-style):**

```mermaid
graph TB
    subgraph "Run List"
        R1["Run #1 ✓"]
        R2["Run #2 ✓"]
        R3["Run #3 ✗"]
    end
    subgraph "Selected: Run #1"
        M["Metrics<br/>lifetime · fuel · altitude<br/>eclipse · contact time"]
        C["Time series curves<br/>altitude · eccentricity<br/>fuel mass"]
        B["Bar charts<br/>fuel budget · eclipse<br/>ground contact"]
    end
    subgraph "AI Assistant"
        Q["Engineer: Why is RF margin negative?"]
        A["AI: Source: RF-COMLINK_Report.csv<br/>Margin = -2.3 dB at t=4500s<br/>Cause: ground station not visible"]
    end
```

**Tip:** Use a screenshot of the actual Results page if available — more impactful than a wireframe.

---

## Slide 7: Validation & Limitations

**Content (two columns):**

**Left — Validation (green):**
- 96 backend + 17 frontend test files
- GMAT template hash validation
- `run_manifest.json` with SHA256 + provenance
- Validated cases: Hohmann, electric propulsion, orbit keeping

**Right — Limitations (orange/red):**
- Fixed satellite (no mass recompute)
- Limited GMAT scenarios (80% coverage)
- Read-only AI assistant (no execution)

**Visual — Validation coverage:**

```mermaid
pie title Test coverage by module
    "Mission pipeline" : 25
    "GMAT templates" : 20
    "Digital thread" : 15
    "AI assistant" : 15
    "Run management" : 15
    "Other" : 10
```

**Tip:** The pie chart is illustrative — adjust numbers if you have real counts.

---

## Slide 8: Assessment & Outcomes

**Content:**
- Technical: developer → architect
- Full-stack TypeScript (Fastify + React)
- 4 heterogeneous tools integrated
- AI that acknowledges its limits
- Key lesson: reliability > automation (pivot from AI orchestration)
- Human: China, foreign language, new field

**Visual — Skill progression:**

```mermaid
graph LR
    A["Developer<br/>implements features"] --> B["Integrator<br/>connects 4 tools"]
    B --> C["Architect<br/>designs for robustness<br/>& traceability"]
```

**Tip:** Keep this slide light on text — the speech carries the personal reflection.

---

## Slide 9: Conclusion & Perspectives

**Content:**
- Answer to problem: YES — IDM can be integrated via automated + traceable chain
- 4 objectives met
- Short-term: expose tool to AI agent (tool calling)
- Medium-term: augmented concurrent engineering room

**Visual — Future roadmap:**

```mermaid
graph LR
    NOW["Today<br/>Deterministic tool<br/>Multi-run comparison ✓"] --> SHORT["Short-term<br/>AI tool calling<br/>Iterative advisory loop"]
    SHORT --> MID["Medium-term<br/>Augmented concurrent<br/>engineering room"]
```

**Tip:** End with the key takeaway as a punchline on the slide:
> "Computational rigor and AI assistance can coexist, in the service of the engineer."

---

## Slide 10: Acknowledgments

**Content:**
- Dr. Farid Gamgami (supervisor)
- Laboratory team (welcome)
- Mrs. Costil, UTBM (academic tutor)
- Mr. He, Shanghai University (academic tutor)

**Visual:** Clean slide, names + affiliations, no diagram. Optional: group photo or lab photo as background.

---

## Summary: Slide Count

| # | Slide | Key visual |
|---|---|---|
| 1 | Title | Logos |
| 2 | Outline | Numbered list |
| 3 | Context | Org chart (mermaid) |
| 4 | Problem & Objectives | 2x2 grid (mermaid) |
| 5 | Methodology | Timeline (mermaid) |
| 6a | Demonstrator | Pipeline flow (mermaid) |
| 6b | Digital thread + templates | Provenance diagram (mermaid) |
| 6c | Results page | Wireframe or screenshot |
| 7 | Validation & Limitations | Pie chart + two columns |
| 8 | Assessment | Skill progression (mermaid) |
| 9 | Conclusion | Roadmap (mermaid) |
| 10 | Acknowledgments | Clean text |

**Total: 12 slides for 10 minutes ≈ 50s per slide average.**

---

## Appendix A: Satellite Subsystems Overview

> Reference diagram — can be used as a backup slide for Q&A, or as a small inset on Slide 4 (Problem) to illustrate *why* the interconnections matter.

**All satellite subsystems and their interconnections:**

```mermaid
graph TD
    STR["**Structure**<br/>chassis · interfaces mécaniques"]
    EPS["**EPS**<br/>Electrical Power System<br/>solar panels · batteries · distribution"]
    AOCS["**AOCS**<br/>Attitude & Orbit Control<br/>pointage · stabilisation · station-keeping"]
    PROP["**Propulsion**<br/>thrusters · fuel<br/>orbit maneuvers"]
    THM["**Thermal**<br/>heat pipes · heaters · radiators<br/>temperature regulation"]
    OBDH["**OBDH**<br/>On-Board Data Handling<br/>onboard computer · commands"]
    TTC["**TT&C**<br/>Telemetry, Tracking & Command<br/>RF link with ground"]
    PAY["**Payload**<br/>mission instrument<br/>camera · sensor · experiment"]

    STR ---|"holds"| EPS
    STR ---|"holds"| AOCS
    STR ---|"holds"| PAY

    EPS -->|"power"| AOCS
    EPS -->|"power"| PROP
    EPS -->|"power"| OBDH
    EPS -->|"power"| TTC
    EPS -->|"power"| PAY
    EPS -->|"power"| THM

    AOCS -->|"pointing"| EPS
    AOCS -->|"pointing"| TTC
    AOCS -->|"pointing"| PAY
    AOCS -->|"commands"| PROP

    PROP -->|"thrust"| AOCS

    THM -.->|"temperature"| EPS
    THM -.->|"temperature"| OBDH

    OBDH -->|"data / commands"| TTC
    PAY -->|"data"| OBDH

    TTC <-->|"RF"| GROUND["**Ground stations**"]
```

**Key coupling points (for the speech):**

| Coupling | Why it matters |
|---|---|
| EPS → all subsystems | Everything needs power; battery sizing depends on orbit eclipses |
| AOCS → EPS | Solar panel angle vs. Sun determines power generation |
| AOCS → TT&C / Payload | Antenna and instrument pointing |
| Propulsion ↔ AOCS | Thrusters execute attitude/orbit corrections; electric propulsion drains EPS |
| Orbit (GMAT) → eclipses → EPS | Trajectory defines eclipse duration → battery depth of discharge |
| OBDH ↔ TT&C | Telemetry down, commands up |

---

## Appendix B: Chain Reaction — Adding a Solar Panel

> Reference diagram — illustrates the cascade effect that the demonstrator makes visible. Best used during Q&A if the jury asks *« what happens when you change one parameter? »*.

**Scenario: the engineer adds one solar panel to increase power generation.**

```mermaid
graph TD
    START(("**+1 Solar Panel**"))

    START -->|"surface + mass"| S1["Structure<br/>mass ↑ · surface ↑"]
    S1 -->|"drag ↑ in LEO"| S2["Orbit (GMAT)<br/>faster decay"]
    S2 -->|"more corrections needed"| S3["Propulsion<br/>fuel consumption ↑"]
    S3 -->|"if electric propulsion"| S4["EPS demand ↑<br/>but panel funds it"]

    START -->|"more generated power"| E1["EPS<br/>available power ↑"]
    E1 -->|"can sustain electric thrust"| S4

    START -->|"extra surface"| T1["Thermal<br/>radiative balance changes"]
    T1 -->|"battery temperature shifts"| E2["EPS battery<br/>performance affected"]

    S2 -->|"eclipse pattern"| E3["EPS<br/>battery depth of discharge"]
    E3 -->|"battery sizing"| E1

    START -->|"surface / mass / CG"| A1["AOCS<br/>torques change<br/>CG shifts"]
    A1 -->|"pointing accuracy"| E4["EPS<br/>sun angle on panels"]
    A1 -->|"pointing accuracy"| T2["TT&C<br/>antenna pointing"]
    A1 -->|"pointing accuracy"| P1["Payload<br/>instrument pointing"]

    E1 -->|"power budget"| TTC["TT&C<br/>transmit power"]
    E1 -->|"power budget"| P1

    classDef start fill:#ffd700,stroke:#333,stroke-width:2px,color:#000;
    classDef orbit fill:#e1f5ff,stroke:#0288d1,stroke-width:1px;
    classDef eps fill:#e8f5e9,stroke:#2e7d32,stroke-width:1px;
    classDef aocs fill:#fff3e0,stroke:#e65100,stroke-width:1px;
    classDef therm fill:#fce4ec,stroke:#c62828,stroke-width:1px;
    classDef other fill:#f3e5f5,stroke:#6a1b9a,stroke-width:1px;

    class START start;
    class S2 orbit;
    class E1,E2,E3,E4 eps;
    class A1 aocs;
    class T1 therm;
    class S1,S3,S4,TTC,P1 other;
```

**The cascade in one line (for the speech):**

> *« Add one solar panel → the structure mass changes → the orbit decays faster → propulsion needs more fuel → if it's electric, the panel pays for itself → meanwhile the thermal balance shifts, the CG moves, the AOCS torques change, and the pointing of the antennas and payload is affected. One value, seven subsystems impacted. »*

**How the demonstrator reveals this:**

| Tool | What it computes in the cascade |
|---|---|
| GMAT | Orbit decay from increased drag (surface ↑) |
| Simu-CIC | Eclipse duration → battery depth of discharge; attitude torques from CG shift |
| OPALIS | Power budget: panel output vs. propulsion + payload demand |
| RF-COMLINK | Link budget: does the extra power help transmissions? Does the new attitude keep antennas pointed? |
