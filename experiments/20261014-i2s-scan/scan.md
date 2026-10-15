# Capacity scan (validation split; reported, never gated)

σ = 1° slice. Medians with 2000-resample bootstrap 95% intervals; range and course at
zig + 300 s, speed at zig + 600 s (the G2 points). Naive and classical on the same rows.

| Estimator | Params | Epochs (best) | s / epoch | Speed weight | n (300 / 600) | Range | Course | Speed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `naive` | – | – | – | – | 4690 / 3014 | 37.4% [36.5%, 38.4%] | 90.64° [87.85°, 93.19°] | 4.25 kt [4.11 kt, 4.41 kt] |
| `classical` | – | – | – | – | 4690 / 3014 | 8.2% [7.8%, 8.7%] | 3.38° [3.15°, 3.66°] | 0.60 kt [0.56 kt, 0.64 kt] |
| `lstm-i-128u-x2` | 203,268 | 30 (28) | 762 | 1 | 4690 / 3014 | 17.0% [16.5%, 17.6%] | 10.16° [9.71°, 10.58°] | 2.24 kt [2.14 kt, 2.33 kt] |
| `lstm-i-192u` | 156,676 | 30 (28) | 554 | 1 | 4690 / 3014 | 18.6% [18.0%, 19.3%] | 10.62° [10.10°, 11.22°] | 2.25 kt [2.14 kt, 2.35 kt] |
| `lstm-i-96u` | 41,476 | 30 (29) | 250 | 1 | 4690 / 3014 | 21.7% [21.1%, 22.7%] | 13.10° [12.61°, 13.71°] | 2.90 kt [2.79 kt, 2.98 kt] |
