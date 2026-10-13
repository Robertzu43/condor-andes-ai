# Final fix report

Fixed P3 in `scripts/plot-learning.py`: probability evidence now requires an applied flap/wait decision and exactly two unique flap/wait entries with finite numeric probabilities in [0,1], summing to 1 within 0.01. Booleans, missing entries, duplicates, unknown actions/choices, nonnumeric/nonfinite values and invalid sums are skipped without crashing. No dependencies or application behavior changed.

Validation command: `../chart-env/bin/python scripts/plot-learning.test.py`

Result: `Ran 1 test ... OK`. The integration test renders 24 isolated decision cases and verifies exactly the three valid distributions produce plotted points, including reversed ordering, chosen wait, and an accepted sum within tolerance.

Real-evidence verification: ran the HEAD version and updated script with `runpy.run_path` against `docs/results/2026-10-12-experiment.json`, compared their `points` and SHA256 of generated PNG files with an assertion. Result: PASS; plotted points and PNG bytes identical. SHA256: `bb3447c8592e7e458c58660b7e805a1a255b9333828015be6e4e09ae66d62eb5`. Real dataset and published figure were not modified.

Scope: script and Python integration test only. Application/API/browser checks were not repeated because their code was unchanged. Authoring test requires the existing Matplotlib environment.
