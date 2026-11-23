# Risk model

Repository Steward uses an ordinal R0-R6 scale. A detector may declare a risk,
but the central classifier can only raise that value when evidence implies a
higher-risk class. It never silently downgrades a detector result.

| Class | Meaning | Default treatment |
| --- | --- | --- |
| R0 | Informational inventory or policy observation | Dashboard only |
| R1 | Low-risk metadata or dependency-automation maintenance | Candidate only after pilot approval |
| R2 | Documentation or deterministic generated-output maintenance | Human-reviewed candidate |
| R3 | Routine source maintenance with no protected paths | Full validation and human review |
| R4 | Runtime, CI, workflow, deployment, or behavior uncertainty | Advisory or escalated review |
| R5 | Security, authentication, authorization, or release controls | Security-owner review |
| R6 | Protected scientific artifacts, baselines, claims, destructive migrations, or other hard boundaries | Advisory only; never autonomous |

Risk is distinct from confidence. A future detector contract must report both;
unknown or incomplete collection must never be interpreted as absence.
