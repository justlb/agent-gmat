# Defense Script — Justine LE BOURG

Target duration: approximately 10 minutes. The appendix slides (25–26) are for questions and are not presented during the main talk.

---

## Slide 1 — Introduction [0:00–0:20]

Hello everyone, I am Justine Le Bourg, a final-year Mechanical Engineering student at UTBM, completing a dual-degree programme with Shanghai University.

Today I will present my six-month final-year project in Microsat, in Shanghai. The project is entitled: Integrating the IDM Satellite Engineering Library into the Laboratory’s Design Process.


## Slide 2 — Outline [0:20–0:30]

I will first present the context and the problem. Then I will explain how I built the demonstrator. Finally, I will present its limits, the next steps, and what I learned during the internship.

## Slide 3 — Chinese Academy of Sciences and Microsat [0:30–1:05]

My internship took place at Microsate, the Innovation Academy for Microsatellites of the Chinese Academy of Science
It belongs to the Chinese Academy of Sciences, China’s leading national research organisation in science and technology. Microsat has developed and launched more than one hundred satellites, including missions such as QUESS, DAMPE, and SMILE.


## Slide 4 — Host laboratory [1:05–1:30]

I worked in the Key Laboratory for Satellite Digitalisation Technology, within the APSL team.

The laboratory works on keeping data, models, and simulations consistent during a satellite project. APSL works on concurrent engineering, where specialists work together from the first stages.

## Slide 5 — Digital thread [1:30–1:45]

The long-term goal is a digital thread: a reliable link between project data, models, and results. My project is one part of it. It studies how orbit choices affect a satellite mission.

## Slide 6 — The engineering problem [1:45–2:15]

A satellite is a system usually subdivised in 8 subsystem, all lead by differents teams. However, a satellite is an interconnected systems. 
For example, the orbit determines eclipse periods. Eclipse periods affect the solar energy available. That energy affects the sizing and performance of the electrical system. The sizing affect the mass of the total satellite and thus, the orbit .
However, the software tools used for these analyses traditionally work independently. The challenge was therefore to make the information flow consistently between these tools.


## Slide 7 — Objectives [2:15–2:40]

My question was: how can we study orbit changes for one satellite quickly, with consistent data and a clear history for every result?

My objectives were to connect the tools, automate the chain, record the source of every value, and prepare a reliable service for AI.

## Slide 8 — Phase one: inventory [2:40–3:00]

First, I reviewed 54 tools in the IDM library and selected four: GMAT, Simu-CIC, OPALIS, and RF-COMLINK. Together, they cover orbit, illumination, power, and telecommunications.

## Slide 9 — Phase two: proofs of concept [3:00–3:20]

Then I wrote Python scripts to pass a GMAT trajectory to Simu-CIC and reuse its data for power and radio-link studies. This proved that the data flow was possible.

## Slide 10 — Phase three: AI orchestration [3:20–4:00]

For the third phase, I built an AI-orchestrated project on top of the scripts I had developed earlier.

I explained to the AI how to use every script: its inputs, outputs, and place in the complete sequence.

In this first architecture, the engineer starts with a request in normal language. The AI collects values, chooses scripts, prepares files, and reads intermediate results. It sits between almost every tool.

At this stage, the AI was responsible for the complete chain, from the first request to the final results.

## Slide 11 — Why AI orchestration was not robust [4:00–4:35]

However, this architecture revealed a weakness. Because the AI sat between every tool, it had to make decisions and deal with errors at every step.

The workflow was slow. More importantly, the same prompt could give different results. I could not guarantee that an engineer would be able to repeat a study or explain exactly what had happened.

This gave me one simple design rule: before using AI, the workflow itself must be fixed, clear, and checked by an engineer.

## Slide 12 — Phase four: deterministic redesign [4:35–5:10]

At that point, I made the decision to restart the project from a different angle. Instead of asking how an AI agent could control the tools, I started with a simpler question: what should an engineer be able to do from the interface?

The engineer should select a satellite, choose a mission, enter parameters, launch one study, and understand the result. Starting from this user path gave me control over the workflow.

On the left, the diagram shows the frontend: inputs, satellite data, results, and the assistant. On the right, the backend creates one mission run, runs GMAT, then Simu-CIC, then the power and radio-link studies.

The application now defines the sequence. The AI only explains saved results after the calculation.

## Slide 13 — The demonstrator: a concrete mission run [5:10–5:50]

Let me show one example. An engineer starts from a reference satellite with a chemical-propulsion system for orbit-maintenance scenario, then selects the ground-station configuration, and enters the target orbit.


The application creates one study. GMAT calculates the trajectory. Simu-CIC calculates illumination, eclipse time, and ground-station visibility. OPALIS studies power and RF-COMLINK studies the radio link.

The engineer has one study where inputs, files, status, and results stay together.

## Slide 14 — From results to an engineering choice [5:50–6:25]

This is the results page. It allows the engineer to explore and use the information produced by a study.

In the centre, graphs, tables, and the generated artefacts show the results of the selected runs. On the left, the engineer can find the complete history of previous runs and select up to five of them for comparison.

In this example, I compare three runs with the same satellite and mission configuration. Only the altitude range has changed. This makes it possible to see the effect of this single choice on the results.

On the right, the engineer can ask the language model to compare the selected runs. It uses the computed and saved data to explain the differences. The engineer still decides which trade-off best matches the mission requirements.

## Slide 15 — Why the demonstrator is reliable [6:20–7:00]

The main element behind this reliability is the `satellite.json` file.

Before a run, the application puts every value needed by the tools into this file: satellite data, mission data, and engineer inputs. All four tools use this source. The file also records where each value comes from.

With the same inputs and templates, the run follows the same steps and gives the same results. Template tests detect unwanted changes, and two identical runs give identical results.

Finally, the AI only reads a generated output file, which contains the useful results and their sources.

## Slide 16 — The appropriate role of AI [7:00–7:25]

The AI can already compare saved simulations and answer which one gives the best trade-off between signal delay and propagation time.

It reads the generated output file; it does not run its own calculation. In the future, an optimisation algorithm could test many allowed values and search for a configuration that meets given requirements. Every case would remain saved and traceable.

## Slide 17 — Limits [7:25–8:00]

The demonstrator covers only orbit maintenance and orbit transfer, with chemical or electric propulsion. It does not cover every scenario the laboratory may need.

Also, a GMAT script can run without an error even if its settings do not match the mission objective. A completed calculation may therefore not reach the expected goal.

Finally, today’s satellites are reference models built from public information and local documentation. The next step is to connect the project to the laboratory database and test real satellite models.

## Slide 18 — Project conclusion [8:00–8:25]

For the project itself, I achieved the main objective. The demonstrator connects specialist tools into one controlled workflow for a given satellite and mission.

It is not a complete concurrent-engineering platform. Its contribution is more focused: it gives the laboratory a service that can be repeated, checked, and improved later.

## Slide 19 — Perspectives [8:25–8:55]

The next steps are to connect the demonstrator to the laboratory database, add mission templates, and use it on real studies.

Later, it can become one service inside the laboratory’s digital thread. AI can help engineers ask questions and compare saved results, while the application stays responsible for calculations.



## Slide 20 — Internship assessment and skills developed [8:55–9:35]

Beyond the demonstrator itself, this internship changed the way I approach engineering work.

I strengthened my programming and integration skills by connecting tools that were not designed to work together. I also built a foundation in orbital mechanics and satellite subsystems.

But the main lesson was about systems engineering. At the beginning, I focused on making the code run. During the project, I learned that a calculation is useful only if an engineer can understand its inputs, its limits, and its results.

This shift, from a technical solution to an engineer-centred tool, is what I will take from this internship.

## Slide 21 — Acknowledgments and closing [9:35–9:50]

I would like to thank Dr. Farid Gamgami for his supervision, the laboratory team for their welcome, and my academic tutors, Mrs Costil from UTBM and Mr He from Shanghai University, for their guidance.

Thank you for your attention. I will be happy to answer your questions.

---
