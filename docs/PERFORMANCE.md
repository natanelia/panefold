# Panefold performance audit

Updated from the merged-code run on 2026-09-28.

## Merged result

PRs #39–#45 are merged. This report replaces the earlier pre-merge benchmark summary.
Measured merge commit: `e08334f87dedb0d0418e8cf35fbc193a2db1984e`. Baseline: `81b11b4fab78a8824243fd6b3a28e50131b997f0`.
Source tree: `d053a4371387521ace7e893bca16ebc2a97a28fd`. [Executed workflow](https://github.com/natanelia/panefold/actions/runs/36372474835).

The documentation website renders this Markdown file directly. There is no separate copy of the benchmark values.

## Measurement method and limits

Each workload ran three times per listed environment. Each run uses warmup, 21 alternating baseline/candidate batches, and a seeded 2,000-resample bootstrap interval for median paired speedup.
The before and merged times below are medians of the three per-run medians, in microseconds per complete function call. Speedup is the range of per-run paired medians. Do not calculate it from the independently summarized time columns.
The interval column is the envelope of the three individual 95% intervals. It is not a pooled 95% confidence interval. All controls and detected slowdowns remain visible. These exploratory comparisons have no multiple-comparison correction.

These results compare the merged implementation with the pinned original. The full solve in the group-constraint suite includes both constraint and allocation changes. It must not be attributed to #40 alone. The allocation suite uses the same constraint callback in both solvers to isolate rounding.
Envelope timings await the checksum. Only sha256 rows use real Web Crypto SHA-256; preparation rows use a test digest. Storage I/O, complete UI latency, and physical 60 Hz/120 Hz certification are excluded. Browser measurements use synthetic DOM layouts, not a complete pointer gesture.

## Environments

| Runtime  | CPU                             | Operating system  | Started (UTC)            |
| -------- | ------------------------------- | ----------------- | ------------------------ |
| v22.23.2 | AMD EPYC 9V74 80-Core Processor | 6.17.0-1022-azure | 2026-09-28T03:08:30.862Z |
| v24.21.0 | AMD EPYC 9V74 80-Core Processor | 6.17.0-1022-azure | 2026-09-28T03:08:21.025Z |

Browser: Chromium 151.0.7922.34, in the Node 24 job. Runtime rows use separate runners. Do not compare their absolute speeds as a Node-version test.

## Selected workloads

These cases show the main affected paths. The complete tables below include small-layout, no-change, single-change, and long-string controls.

| Workload (Node 24)                  | Before / merged (µs) | Paired speedup range | Result             |
| ----------------------------------- | -------------------: | -------------------: | ------------------ |
| Canonical hash, 24 panels           |    614.546 / 173.395 |         3.532–3.555× | Faster in 3/3 runs |
| Constraints, 50 tabs                |        1.866 / 0.716 |         2.600–2.659× | Faster in 3/3 runs |
| Combined solve, 16 groups × 50 tabs |      79.383 / 55.831 |         1.394–1.437× | Faster in 3/3 runs |
| Weighted allocation, 64 children    |      23.886 / 20.041 |         1.181–1.195× | Faster in 3/3 runs |
| 500 constraint changes / 500 groups |  31325.517 / 780.954 |       37.656–48.422× | Faster in 3/3 runs |
| Weight-only resize / 500 groups     |    412.935 / 168.921 |         2.261–2.558× | Faster in 3/3 runs |
| Bounded validation, 24 panels       |    504.794 / 204.584 |         2.382–2.480× | Faster in 3/3 runs |
| Envelope with SHA-256, 500 panels   |  8238.875 / 4968.626 |         1.652–1.664× | Faster in 3/3 runs |
| DOM drop measurement, 50 groups     |    215.625 / 123.438 |         1.741–1.771× | Faster in 3/3 runs |
| DOM drop measurement, 500 groups    | 10125.000 / 1300.000 |         7.638–7.961× | Faster in 3/3 runs |

## Regression checks on merged code

Node 22: 578/578 unit tests passed in 76 files. Full pnpm check passed in the same workflow.
Node 24: 578/578 unit tests passed in 76 files. Full pnpm check passed in the same workflow.
Main Chromium suite: 56 passed, 0 skipped. Site suite: 18 passed, 2 skipped. Neither report contains a failure or flaky test.

The independent semantic campaign report is retained with the raw results. The ten-million-command and physical-device certification gates remain unmet.

## Complete paired results

### Node 22: Exact fingerprints

| Workload                    | Before / merged (µs) | Speedup range | Interval envelope | Result             |
| --------------------------- | -------------------: | ------------: | ----------------: | ------------------ |
| canonical/0-panels/ascii    |      31.443 / 10.091 |  3.096–3.124× |      3.082–3.138× | Faster in 3/3 runs |
| semantic/0-panels/ascii     |      30.665 / 10.571 |  2.900–2.907× |      2.885–2.924× | Faster in 3/3 runs |
| canonical/24-panels/ascii   |    800.613 / 224.103 |  3.557–3.602× |      3.481–3.606× | Faster in 3/3 runs |
| semantic/24-panels/ascii    |    800.203 / 224.856 |  3.563–3.584× |      3.495–3.593× | Faster in 3/3 runs |
| canonical/500-panels/ascii  | 15631.143 / 4798.623 |  3.219–3.248× |      3.166–3.317× | Faster in 3/3 runs |
| semantic/500-panels/ascii   | 15633.237 / 4830.937 |  3.214–3.251× |      3.162–3.345× | Faster in 3/3 runs |
| canonical/24-panels/unicode |   1858.882 / 434.023 |  4.280–4.309× |      4.178–4.347× | Faster in 3/3 runs |
| semantic/24-panels/unicode  |   1854.349 / 433.441 |  4.291–4.325× |      4.207–4.338× | Faster in 3/3 runs |

### Node 22: Group constraints and combined layout solve

| Workload                | Before / merged (µs) | Speedup range | Interval envelope | Result             |
| ----------------------- | -------------------: | ------------: | ----------------: | ------------------ |
| constraints/1-tabs      |        0.197 / 0.120 |  1.346–2.452× |      1.343–2.467× | Faster in 3/3 runs |
| constraints/8-tabs      |        0.535 / 0.179 |  2.941–3.008× |      2.935–3.026× | Faster in 3/3 runs |
| constraints/50-tabs     |        2.634 / 0.762 |  3.366–3.627× |      3.353–3.635× | Faster in 3/3 runs |
| constraints/500-tabs    |       27.327 / 7.751 |  3.095–3.508× |      3.090–3.533× | Faster in 3/3 runs |
| solve/1-groups/1-tabs   |        0.703 / 0.482 |  1.411–1.498× |      1.409–1.506× | Faster in 3/3 runs |
| solve/8-groups/1-tabs   |      14.414 / 13.433 |  1.054–1.102× |      1.044–1.114× | Faster in 3/3 runs |
| solve/8-groups/8-tabs   |      18.050 / 15.565 |  1.155–1.229× |      1.153–1.231× | Faster in 3/3 runs |
| solve/16-groups/50-tabs |      90.690 / 66.285 |  1.367–1.462× |      1.359–1.467× | Faster in 3/3 runs |

### Node 22: Pixel allocation

| Workload               | Before / merged (µs) | Speedup range | Interval envelope | Result                           |
| ---------------------- | -------------------: | ------------: | ----------------: | -------------------------------- |
| axis/integral/2        |        2.465 / 2.041 |  1.040–1.201× |      0.819–1.211× | Inconclusive in at least one run |
| axis/weighted/2        |        2.588 / 2.291 |  1.129–1.150× |      1.124–1.156× | Faster in 3/3 runs               |
| axis/integral/8        |        4.706 / 3.945 |  1.178–1.200× |      1.175–1.210× | Faster in 3/3 runs               |
| axis/weighted/8        |        5.129 / 4.641 |  1.104–1.113× |      1.097–1.116× | Faster in 3/3 runs               |
| axis/integral/64       |      23.631 / 20.279 |  1.165–1.169× |      1.159–1.183× | Faster in 3/3 runs               |
| axis/weighted/64       |      31.483 / 26.730 |  1.174–1.181× |      1.166–1.183× | Faster in 3/3 runs               |
| axis/fractional-bounds |        5.422 / 4.876 |  1.091–1.120× |      1.079–1.134× | Faster in 3/3 runs               |
| axis/emergency-shrink  |        4.109 / 3.695 |  1.094–1.118× |      1.089–1.127× | Faster in 3/3 runs               |
| axis/emergency-grow    |        5.500 / 4.975 |  1.104–1.131× |      1.089–1.140× | Faster in 3/3 runs               |
| axis/collapse          |        5.262 / 4.949 |  1.064–1.074× |      1.059–1.078× | Faster in 3/3 runs               |
| solve/2-groups         |        6.051 / 5.775 |  1.051–1.056× |      0.916–1.070× | Inconclusive in at least one run |
| solve/8-groups         |      13.584 / 13.245 |  1.019–1.045× |      1.016–1.053× | Faster in 3/3 runs               |
| solve/32-groups        |      44.160 / 44.106 |  0.998–1.022× |      0.991–1.030× | Inconclusive in at least one run |

### Node 22: Invalidation controls

| Workload                             | Before / merged (µs) |    Speedup range | Interval envelope | Result                           |
| ------------------------------------ | -------------------: | ---------------: | ----------------: | -------------------------------- |
| empty/2-groups                       |        2.440 / 0.359 |     6.649–6.869× |      6.633–6.887× | Faster in 3/3 runs               |
| panel-parameters/2-groups            |        2.522 / 0.367 |     6.787–6.959× |      6.761–6.973× | Faster in 3/3 runs               |
| tab-reorder/2-groups                 |        2.672 / 0.467 |     5.660–5.741× |      5.649–5.772× | Faster in 3/3 runs               |
| constraint-control/2-groups          |        3.865 / 3.795 |     1.019–1.021× |      1.016–1.024× | Faster in 3/3 runs               |
| weights-control/2-groups             |        3.370 / 1.806 |     1.851–1.890× |      1.847–1.892× | Faster in 3/3 runs               |
| mixed-50-percent-geometry/2-groups   |        3.284 / 2.080 |     1.552–1.585× |      1.546–1.589× | Faster in 3/3 runs               |
| empty/16-groups                      |       15.661 / 0.370 |   41.756–42.598× |    41.254–42.854× | Faster in 3/3 runs               |
| panel-parameters/16-groups           |       15.884 / 0.378 |   41.629–43.105× |    41.208–43.428× | Faster in 3/3 runs               |
| tab-reorder/16-groups                |       16.037 / 0.477 |   33.501–34.266× |    33.034–34.319× | Faster in 3/3 runs               |
| constraint-control/16-groups         |      21.069 / 21.177 |     0.996–0.999× |      0.990–1.003× | Slowdown in 1/3 runs             |
| weights-control/16-groups            |       20.387 / 9.307 |     2.184–2.246× |      2.178–2.254× | Faster in 3/3 runs               |
| mixed-50-percent-geometry/16-groups  |      18.627 / 10.818 |     1.710–1.733× |      1.705–1.741× | Faster in 3/3 runs               |
| empty/128-groups                     |      121.075 / 0.370 | 324.805–335.972× |  322.245–340.122× | Faster in 3/3 runs               |
| panel-parameters/128-groups          |      123.793 / 0.378 | 320.752–335.070× |  316.719–338.910× | Faster in 3/3 runs               |
| tab-reorder/128-groups               |      124.058 / 0.474 | 258.581–265.574× |  256.319–268.513× | Faster in 3/3 runs               |
| constraint-control/128-groups        |    161.737 / 160.494 |     1.008–1.017× |      0.994–1.033× | Inconclusive in at least one run |
| weights-control/128-groups           |     163.787 / 62.793 |     2.560–2.621× |      2.540–2.666× | Faster in 3/3 runs               |
| mixed-50-percent-geometry/128-groups |     147.764 / 80.589 |     1.833–1.837× |      1.821–1.857× | Faster in 3/3 runs               |

### Node 22: Invalidation batches

| Workload                   | Before / merged (µs) |    Speedup range | Interval envelope | Result                           |
| -------------------------- | -------------------: | ---------------: | ----------------: | -------------------------------- |
| empty/1-groups             |        1.391 / 0.358 |     3.860–3.944× |      3.843–3.973× | Faster in 3/3 runs               |
| metadata/1-groups          |        1.435 / 0.364 |     3.874–3.963× |      3.863–4.006× | Faster in 3/3 runs               |
| panel-title/1-groups       |        1.447 / 0.373 |     3.875–3.949× |      3.850–4.004× | Faster in 3/3 runs               |
| group-chrome/1-groups      |        1.510 / 0.419 |     3.587–3.613× |      3.567–3.623× | Faster in 3/3 runs               |
| one-constraint/1-groups    |        2.546 / 2.423 |     1.031–1.067× |      1.028–1.069× | Faster in 3/3 runs               |
| all-constraints/1-groups   |        2.544 / 2.447 |     1.032–1.060× |      1.027–1.070× | Faster in 3/3 runs               |
| weights/1-groups           |        2.123 / 1.440 |     1.468–1.482× |      1.465–1.491× | Faster in 3/3 runs               |
| empty/8-groups             |        5.982 / 0.368 |   16.043–16.537× |    15.850–16.686× | Faster in 3/3 runs               |
| metadata/8-groups          |        5.988 / 0.372 |   15.898–16.404× |    15.861–16.458× | Faster in 3/3 runs               |
| panel-title/8-groups       |        6.010 / 0.378 |   15.685–16.342× |    15.593–16.414× | Faster in 3/3 runs               |
| group-chrome/8-groups      |        6.063 / 0.426 |   14.107–14.525× |    12.873–14.568× | Faster in 3/3 runs               |
| one-constraint/8-groups    |        8.972 / 8.944 |     0.997–1.003× |      0.993–1.006× | Inconclusive in at least one run |
| all-constraints/8-groups   |      22.385 / 12.241 |     1.830–1.865× |      1.809–1.880× | Faster in 3/3 runs               |
| weights/8-groups           |        8.399 / 5.067 |     1.654–1.674× |      1.647–1.680× | Faster in 3/3 runs               |
| empty/50-groups            |       32.008 / 0.364 |   87.490–88.013× |    85.765–89.120× | Faster in 3/3 runs               |
| metadata/50-groups         |       32.039 / 0.375 |   85.846–86.504× |    84.119–88.302× | Faster in 3/3 runs               |
| panel-title/50-groups      |       32.108 / 0.375 |   84.547–85.514× |    82.731–87.063× | Faster in 3/3 runs               |
| group-chrome/50-groups     |       31.999 / 0.420 |   75.676–76.629× |    74.259–77.172× | Faster in 3/3 runs               |
| one-constraint/50-groups   |      44.664 / 44.884 |     0.994–0.998× |      0.987–1.005× | Slowdown in 1/3 runs             |
| all-constraints/50-groups  |     465.848 / 71.941 |     6.324–6.494× |      6.162–6.556× | Faster in 3/3 runs               |
| weights/50-groups          |      44.375 / 22.262 |     1.987–2.015× |      1.978–2.020× | Faster in 3/3 runs               |
| empty/500-groups           |      334.066 / 0.387 | 850.585–883.647× |  833.626–919.639× | Faster in 3/3 runs               |
| metadata/500-groups        |      333.980 / 0.389 | 856.476–879.994× |  828.482–912.205× | Faster in 3/3 runs               |
| panel-title/500-groups     |      338.526 / 0.396 | 856.757–878.003× |  826.746–901.357× | Faster in 3/3 runs               |
| group-chrome/500-groups    |      342.234 / 0.443 | 752.015–778.049× |  732.946–820.976× | Faster in 3/3 runs               |
| one-constraint/500-groups  |    531.472 / 529.092 |     1.002–1.013× |      0.993–1.019× | Inconclusive in at least one run |
| all-constraints/500-groups | 39113.245 / 1051.923 |   36.345–39.018× |    35.608–42.378× | Faster in 3/3 runs               |
| weights/500-groups         |    531.791 / 208.797 |     2.540–2.576× |      2.529–2.616× | Faster in 3/3 runs               |

### Node 22: Bounded persistence validation

| Workload             | Before / merged (µs) | Speedup range | Interval envelope | Result                           |
| -------------------- | -------------------: | ------------: | ----------------: | -------------------------------- |
| number               |        0.530 / 0.238 |  2.327–2.404× |      2.318–2.426× | Faster in 3/3 runs               |
| empty-object         |        0.194 / 0.195 |  0.998–1.009× |      0.996–1.010× | Inconclusive in at least one run |
| null                 |        0.039 / 0.039 |  0.996–1.002× |      0.987–1.011× | Slowdown in 1/3 runs             |
| numbers/1000         |    675.406 / 398.716 |  1.694–1.700× |      1.664–1.717× | Faster in 3/3 runs               |
| short-fields/500     |   1882.509 / 719.935 |  2.597–2.718× |      2.520–2.829× | Faster in 3/3 runs               |
| workspace/1-panels   |      71.584 / 36.031 |  1.990–2.016× |      1.963–2.073× | Faster in 3/3 runs               |
| workspace/24-panels  |    630.681 / 274.522 |  2.039–2.313× |      1.999–2.460× | Faster in 3/3 runs               |
| workspace/500-panels | 12324.506 / 6146.066 |  1.993–2.029× |      1.941–2.100× | Faster in 3/3 runs               |
| ascii/8              |        0.475 / 0.092 |  5.008–5.467× |      4.780–5.515× | Faster in 3/3 runs               |
| unicode/8            |        0.625 / 0.067 |  9.095–9.440× |      8.674–9.695× | Faster in 3/3 runs               |
| ascii/127            |        0.692 / 0.541 |  1.227–1.263× |      1.165–1.321× | Faster in 3/3 runs               |
| unicode/127          |        1.662 / 0.589 |  2.715–3.060× |      2.119–3.158× | Faster in 3/3 runs               |
| ascii/128            |        0.693 / 0.548 |  1.179–1.241× |      1.091–1.293× | Faster in 3/3 runs               |
| unicode/128          |        1.646 / 0.592 |  2.627–2.936× |      2.336–3.191× | Faster in 3/3 runs               |
| ascii/129            |        0.781 / 0.777 |  0.987–1.016× |      0.953–1.050× | Inconclusive in at least one run |
| unicode/129          |        2.129 / 2.015 |  0.984–1.087× |      0.900–1.184× | Inconclusive in at least one run |
| ascii/1024           |        4.155 / 4.013 |  1.046–1.082× |      1.018–1.092× | Faster in 3/3 runs               |
| unicode/1024         |        7.134 / 7.358 |  0.955–1.060× |      0.937–1.067× | Inconclusive in at least one run |
| ascii/100000         |    332.061 / 333.146 |  0.988–0.998× |      0.985–1.016× | Inconclusive in at least one run |
| unicode/100000       |    758.929 / 758.053 |  0.999–1.003× |      0.991–1.075× | Inconclusive in at least one run |
| escaped-short        |        2.419 / 0.890 |  2.704–2.750× |      2.673–2.788× | Faster in 3/3 runs               |

### Node 22: Persistence envelope creation

| Workload               | Before / merged (µs) | Speedup range | Interval envelope | Result             |
| ---------------------- | -------------------: | ------------: | ----------------: | ------------------ |
| preparation/0-panels   |      18.194 / 11.831 |  1.535–1.541× |      1.515–1.555× | Faster in 3/3 runs |
| sha256/0-panels        |      63.262 / 55.406 |  1.116–1.135× |      1.099–1.166× | Faster in 3/3 runs |
| preparation/1-panels   |      53.268 / 33.575 |  1.583–1.593× |      1.562–1.607× | Faster in 3/3 runs |
| sha256/1-panels        |     103.470 / 81.935 |  1.245–1.266× |      1.233–1.274× | Faster in 3/3 runs |
| preparation/24-panels  |    410.374 / 252.394 |  1.625–1.633× |      1.602–1.655× | Faster in 3/3 runs |
| sha256/24-panels       |    500.310 / 340.371 |  1.466–1.481× |      1.461–1.488× | Faster in 3/3 runs |
| preparation/500-panels |  9598.607 / 5930.244 |  1.600–1.640× |      1.594–1.670× | Faster in 3/3 runs |
| sha256/500-panels      | 10449.454 / 6490.129 |  1.600–1.619× |      1.586–1.667× | Faster in 3/3 runs |

### Node 24: Exact fingerprints

| Workload                    | Before / merged (µs) | Speedup range | Interval envelope | Result             |
| --------------------------- | -------------------: | ------------: | ----------------: | ------------------ |
| canonical/0-panels/ascii    |       25.170 / 8.079 |  3.109–3.139× |      3.061–3.176× | Faster in 3/3 runs |
| semantic/0-panels/ascii     |       23.496 / 8.186 |  2.860–2.873× |      2.842–2.890× | Faster in 3/3 runs |
| canonical/24-panels/ascii   |    614.546 / 173.395 |  3.532–3.555× |      3.525–3.570× | Faster in 3/3 runs |
| semantic/24-panels/ascii    |    610.853 / 174.351 |  3.404–3.539× |      3.008–3.550× | Faster in 3/3 runs |
| canonical/500-panels/ascii  | 12307.417 / 3845.458 |  3.146–3.214× |      3.062–3.268× | Faster in 3/3 runs |
| semantic/500-panels/ascii   | 12302.860 / 3824.962 |  3.174–3.232× |      3.115–3.267× | Faster in 3/3 runs |
| canonical/24-panels/unicode |   1472.788 / 350.082 |  4.168–4.210× |      4.139–4.220× | Faster in 3/3 runs |
| semantic/24-panels/unicode  |   1473.382 / 349.776 |  4.128–4.217× |      4.052–4.236× | Faster in 3/3 runs |

### Node 24: Group constraints and combined layout solve

| Workload                | Before / merged (µs) | Speedup range | Interval envelope | Result                           |
| ----------------------- | -------------------: | ------------: | ----------------: | -------------------------------- |
| constraints/1-tabs      |        0.136 / 0.062 |  2.209–2.569× |      2.204–2.593× | Faster in 3/3 runs               |
| constraints/8-tabs      |        0.365 / 0.158 |  2.245–2.324× |      2.228–2.329× | Faster in 3/3 runs               |
| constraints/50-tabs     |        1.866 / 0.716 |  2.600–2.659× |      2.597–2.674× | Faster in 3/3 runs               |
| constraints/500-tabs    |       18.812 / 6.660 |  2.752–3.007× |      2.724–3.026× | Faster in 3/3 runs               |
| solve/1-groups/1-tabs   |        0.476 / 0.366 |  1.243–1.300× |      1.240–1.303× | Faster in 3/3 runs               |
| solve/8-groups/1-tabs   |      14.285 / 13.135 |  1.054–1.084× |      0.926–1.093× | Inconclusive in at least one run |
| solve/8-groups/8-tabs   |      17.300 / 14.873 |  1.160–1.168× |      1.157–1.175× | Faster in 3/3 runs               |
| solve/16-groups/50-tabs |      79.383 / 55.831 |  1.394–1.437× |      1.386–1.449× | Faster in 3/3 runs               |

### Node 24: Pixel allocation

| Workload               | Before / merged (µs) | Speedup range | Interval envelope | Result             |
| ---------------------- | -------------------: | ------------: | ----------------: | ------------------ |
| axis/integral/2        |        1.778 / 1.454 |  1.230–1.257× |      1.199–1.307× | Faster in 3/3 runs |
| axis/weighted/2        |        1.871 / 1.596 |  1.164–1.188× |      1.162–1.190× | Faster in 3/3 runs |
| axis/integral/8        |        3.447 / 2.858 |  1.198–1.209× |      1.187–1.218× | Faster in 3/3 runs |
| axis/weighted/8        |        3.781 / 3.384 |  1.111–1.128× |      1.107–1.131× | Faster in 3/3 runs |
| axis/integral/64       |      17.871 / 15.180 |  1.161–1.177× |      1.159–1.185× | Faster in 3/3 runs |
| axis/weighted/64       |      23.886 / 20.041 |  1.181–1.195× |      1.173–1.198× | Faster in 3/3 runs |
| axis/fractional-bounds |        3.965 / 3.620 |  1.090–1.108× |      1.083–1.114× | Faster in 3/3 runs |
| axis/emergency-shrink  |        2.982 / 2.648 |  1.120–1.183× |      1.111–1.190× | Faster in 3/3 runs |
| axis/emergency-grow    |        3.973 / 3.581 |  1.097–1.138× |      1.089–1.151× | Faster in 3/3 runs |
| axis/collapse          |        3.942 / 3.688 |  1.058–1.082× |      1.056–1.086× | Faster in 3/3 runs |
| solve/2-groups         |        4.468 / 4.181 |  1.063–1.073× |      1.062–1.079× | Faster in 3/3 runs |
| solve/8-groups         |      10.335 / 10.039 |  1.030–1.042× |      1.026–1.048× | Faster in 3/3 runs |
| solve/32-groups        |      34.014 / 33.779 |  1.005–1.021× |      1.001–1.028× | Faster in 3/3 runs |

### Node 24: Invalidation controls

| Workload                             | Before / merged (µs) |    Speedup range | Interval envelope | Result                           |
| ------------------------------------ | -------------------: | ---------------: | ----------------: | -------------------------------- |
| empty/2-groups                       |        1.881 / 0.271 |     6.839–7.135× |      6.822–7.200× | Faster in 3/3 runs               |
| panel-parameters/2-groups            |        1.900 / 0.278 |     6.845–7.140× |      6.813–7.173× | Faster in 3/3 runs               |
| tab-reorder/2-groups                 |        2.029 / 0.361 |     5.524–5.658× |      5.507–5.682× | Faster in 3/3 runs               |
| constraint-control/2-groups          |        3.033 / 2.918 |     1.033–1.037× |      1.030–1.047× | Faster in 3/3 runs               |
| weights-control/2-groups             |        2.591 / 1.391 |     1.843–1.885× |      1.839–1.896× | Faster in 3/3 runs               |
| mixed-50-percent-geometry/2-groups   |        2.504 / 1.619 |     1.545–1.562× |      1.540–1.568× | Faster in 3/3 runs               |
| empty/16-groups                      |       11.707 / 0.280 |   41.866–42.085× |    38.133–42.847× | Faster in 3/3 runs               |
| panel-parameters/16-groups           |       12.060 / 0.283 |   41.577–43.159× |    40.265–43.329× | Faster in 3/3 runs               |
| tab-reorder/16-groups                |       12.145 / 0.359 |   32.664–34.010× |    31.265–34.150× | Faster in 3/3 runs               |
| constraint-control/16-groups         |      16.018 / 16.031 |     0.982–0.997× |      0.981–1.005× | Slowdown in 1/3 runs             |
| weights-control/16-groups            |       15.945 / 7.193 |     2.187–2.217× |      2.180–2.223× | Faster in 3/3 runs               |
| mixed-50-percent-geometry/16-groups  |       14.538 / 8.513 |     1.690–1.729× |      1.684–1.740× | Faster in 3/3 runs               |
| empty/128-groups                     |       92.469 / 0.276 | 325.791–336.880× |  324.972–339.820× | Faster in 3/3 runs               |
| panel-parameters/128-groups          |       94.784 / 0.285 | 327.369–337.261× |  325.840–342.109× | Faster in 3/3 runs               |
| tab-reorder/128-groups               |       94.727 / 0.359 | 244.973–263.308× |  241.686–267.652× | Faster in 3/3 runs               |
| constraint-control/128-groups        |    123.877 / 123.407 |     0.995–1.016× |      0.988–1.020× | Inconclusive in at least one run |
| weights-control/128-groups           |     123.676 / 50.292 |     2.452–2.499× |      2.396–2.512× | Faster in 3/3 runs               |
| mixed-50-percent-geometry/128-groups |     111.727 / 62.151 |     1.800–1.811× |      1.779–1.837× | Faster in 3/3 runs               |

### Node 24: Invalidation batches

| Workload                   | Before / merged (µs) |    Speedup range | Interval envelope | Result                           |
| -------------------------- | -------------------: | ---------------: | ----------------: | -------------------------------- |
| empty/1-groups             |        1.050 / 0.272 |     3.857–3.910× |      3.851–3.916× | Faster in 3/3 runs               |
| metadata/1-groups          |        1.047 / 0.274 |     3.760–4.002× |      3.752–4.007× | Faster in 3/3 runs               |
| panel-title/1-groups       |        1.045 / 0.276 |     3.771–4.089× |      3.754–4.104× | Faster in 3/3 runs               |
| group-chrome/1-groups      |        1.092 / 0.318 |     3.435–3.534× |      3.424–3.547× | Faster in 3/3 runs               |
| one-constraint/1-groups    |        1.988 / 1.828 |     1.084–1.113× |      1.082–1.117× | Faster in 3/3 runs               |
| all-constraints/1-groups   |        1.988 / 1.826 |     1.086–1.107× |      1.085–1.109× | Faster in 3/3 runs               |
| weights/1-groups           |        1.565 / 1.088 |     1.436–1.497× |      1.432–1.504× | Faster in 3/3 runs               |
| empty/8-groups             |        4.555 / 0.286 |   15.758–16.136× |    15.497–16.217× | Faster in 3/3 runs               |
| metadata/8-groups          |        4.572 / 0.289 |   15.810–15.894× |    15.773–15.956× | Faster in 3/3 runs               |
| panel-title/8-groups       |        4.571 / 0.293 |   15.627–15.649× |    15.541–15.691× | Faster in 3/3 runs               |
| group-chrome/8-groups      |        4.651 / 0.339 |   13.705–13.875× |    13.570–13.959× | Faster in 3/3 runs               |
| one-constraint/8-groups    |        6.881 / 6.875 |     0.996–1.008× |      0.995–1.013× | Slowdown in 1/3 runs             |
| all-constraints/8-groups   |       17.765 / 9.592 |     1.831–1.851× |      1.829–1.861× | Faster in 3/3 runs               |
| weights/8-groups           |        6.592 / 3.906 |     1.665–1.712× |      1.660–1.714× | Faster in 3/3 runs               |
| empty/50-groups            |       24.479 / 0.279 |   68.713–90.061× |    66.784–90.945× | Faster in 3/3 runs               |
| metadata/50-groups         |       24.717 / 0.282 |   87.267–89.285× |    86.436–89.709× | Faster in 3/3 runs               |
| panel-title/50-groups      |       24.902 / 0.285 |   85.763–87.480× |    84.959–88.417× | Faster in 3/3 runs               |
| group-chrome/50-groups     |       24.888 / 0.333 |   74.152–74.777× |    73.648–75.756× | Faster in 3/3 runs               |
| one-constraint/50-groups   |      35.655 / 35.536 |     0.993–1.002× |      0.989–1.006× | Slowdown in 1/3 runs             |
| all-constraints/50-groups  |     365.643 / 55.790 |     6.108–6.786× |      6.038–6.874× | Faster in 3/3 runs               |
| weights/50-groups          |      34.819 / 17.099 |     1.971–2.117× |      1.966–2.124× | Faster in 3/3 runs               |
| empty/500-groups           |      254.283 / 0.283 | 876.604–994.315× | 863.775–1009.575× | Faster in 3/3 runs               |
| metadata/500-groups        |      254.312 / 0.288 | 866.669–979.126× |  842.999–998.804× | Faster in 3/3 runs               |
| panel-title/500-groups     |      257.211 / 0.294 | 848.226–975.815× |  836.113–986.098× | Faster in 3/3 runs               |
| group-chrome/500-groups    |      262.874 / 0.339 | 745.580–852.059× |  726.052–869.649× | Faster in 3/3 runs               |
| one-constraint/500-groups  |    413.475 / 411.192 |     1.000–1.014× |      0.994–1.017× | Inconclusive in at least one run |
| all-constraints/500-groups |  31325.517 / 780.954 |   37.656–48.422× |    36.127–52.202× | Faster in 3/3 runs               |
| weights/500-groups         |    412.935 / 168.921 |     2.261–2.558× |      2.238–2.609× | Faster in 3/3 runs               |

### Node 24: Bounded persistence validation

| Workload             | Before / merged (µs) | Speedup range | Interval envelope | Result                           |
| -------------------- | -------------------: | ------------: | ----------------: | -------------------------------- |
| number               |        0.444 / 0.148 |  3.086–3.172× |      3.015–3.394× | Faster in 3/3 runs               |
| empty-object         |        0.157 / 0.159 |  0.979–1.017× |      0.977–1.020× | Slowdown in 1/3 runs             |
| null                 |        0.031 / 0.030 |  0.985–1.060× |      0.976–1.066× | Slowdown in 1/3 runs             |
| numbers/1000         |    559.729 / 274.887 |  2.026–2.133× |      2.005–2.147× | Faster in 3/3 runs               |
| short-fields/500     |   1535.187 / 469.190 |  3.161–3.289× |      2.997–3.378× | Faster in 3/3 runs               |
| workspace/1-panels   |      56.708 / 24.076 |  2.228–2.373× |      2.208–2.444× | Faster in 3/3 runs               |
| workspace/24-panels  |    504.794 / 204.584 |  2.382–2.480× |      2.229–2.583× | Faster in 3/3 runs               |
| workspace/500-panels | 10443.358 / 4046.021 |  2.421–2.602× |      2.298–2.682× | Faster in 3/3 runs               |
| ascii/8              |        0.414 / 0.074 |  5.130–5.648× |      4.320–6.342× | Faster in 3/3 runs               |
| unicode/8            |        0.555 / 0.055 | 9.027–10.572× |     7.949–10.693× | Faster in 3/3 runs               |
| ascii/127            |        0.551 / 0.343 |  1.570–1.600× |      1.419–1.708× | Faster in 3/3 runs               |
| unicode/127          |        1.559 / 0.349 |  4.062–4.600× |      3.544–4.923× | Faster in 3/3 runs               |
| ascii/128            |        0.582 / 0.323 |  1.627–1.747× |      1.551–1.867× | Faster in 3/3 runs               |
| unicode/128          |        1.565 / 0.353 |  4.160–4.533× |      3.516–4.774× | Faster in 3/3 runs               |
| ascii/129            |        0.702 / 0.697 |  0.967–1.034× |      0.936–1.085× | Inconclusive in at least one run |
| unicode/129          |        1.870 / 1.839 |  0.964–0.977× |      0.927–1.103× | Inconclusive in at least one run |
| ascii/1024           |        2.219 / 2.187 |  0.985–1.011× |      0.930–1.085× | Inconclusive in at least one run |
| unicode/1024         |        5.361 / 5.478 |  0.966–0.999× |      0.928–1.071× | Slowdown in 1/3 runs             |
| ascii/100000         |    140.779 / 140.135 |  1.001–1.002× |      0.998–1.010× | Inconclusive in at least one run |
| unicode/100000       |    598.674 / 601.557 |  0.998–1.001× |      0.990–1.016× | Inconclusive in at least one run |
| escaped-short        |        1.895 / 0.637 |  2.956–2.991× |      2.947–3.002× | Faster in 3/3 runs               |

### Node 24: Persistence envelope creation

| Workload               | Before / merged (µs) | Speedup range | Interval envelope | Result             |
| ---------------------- | -------------------: | ------------: | ----------------: | ------------------ |
| preparation/0-panels   |       14.423 / 9.244 |  1.557–1.569× |      1.551–1.586× | Faster in 3/3 runs |
| sha256/0-panels        |      50.039 / 44.653 |  1.119–1.131× |      1.109–1.160× | Faster in 3/3 runs |
| preparation/1-panels   |      42.260 / 26.535 |  1.584–1.592× |      1.574–1.598× | Faster in 3/3 runs |
| sha256/1-panels        |      90.781 / 74.842 |  1.221–1.257× |      1.215–1.276× | Faster in 3/3 runs |
| preparation/24-panels  |    323.859 / 197.668 |  1.633–1.648× |      1.621–1.660× | Faster in 3/3 runs |
| sha256/24-panels       |    402.602 / 275.217 |  1.468–1.483× |      1.461–1.489× | Faster in 3/3 runs |
| preparation/500-panels |  7588.568 / 4675.109 |  1.599–1.641× |      1.587–1.724× | Faster in 3/3 runs |
| sha256/500-panels      |  8238.875 / 4968.626 |  1.652–1.664× |      1.580–1.687× | Faster in 3/3 runs |

### Node 24: Browser drop measurement

| Workload                  | Before / merged (µs) | Speedup range | Interval envelope | Result                           |
| ------------------------- | -------------------: | ------------: | ----------------: | -------------------------------- |
| unique/1-groups           |        3.040 / 3.027 |  0.996–1.011× |      0.988–1.020× | Slowdown in 1/3 runs             |
| unique/7-groups           |      19.043 / 19.092 |  1.000–1.000× |      0.985–1.005× | Inconclusive in at least one run |
| unique/8-groups           |      21.582 / 19.824 |  1.084–1.094× |      1.083–1.099× | Faster in 3/3 runs               |
| unique/50-groups          |    215.625 / 123.438 |  1.741–1.771× |      1.711–1.806× | Faster in 3/3 runs               |
| unique/200-groups         |   1887.500 / 506.250 |  3.699–3.785× |      3.648–3.823× | Faster in 3/3 runs               |
| unique/500-groups         | 10125.000 / 1300.000 |  7.638–7.961× |      7.458–8.029× | Faster in 3/3 runs               |
| duplicate/50-groups       |  2075.000 / 1981.250 |  1.038–1.113× |      0.919–1.142× | Inconclusive in at least one run |
| hidden/50-groups          |      46.094 / 46.289 |  0.979–1.000× |      0.944–1.004× | Inconclusive in at least one run |
| single-visible/8-groups   |        9.912 / 9.863 |  1.000–1.005× |      0.939–1.119× | Inconclusive in at least one run |
| single-visible/50-groups  |      49.609 / 49.805 |  0.996–1.000× |      0.981–1.012× | Inconclusive in at least one run |
| single-visible/500-groups |    492.188 / 495.313 |  0.994–1.003× |      0.981–1.013× | Inconclusive in at least one run |

## Node smoke checks

These are absolute regression-guard timings, not paired speedup estimates. Ranges cover three runs.

| Runtime / workload                  |       Measured range |
| ----------------------------------- | -------------------: |
| Node 22 / 10,000 kernel commands    | 2178.690–2238.620 ms |
| Node 22 / reorder 50 panels, p95    |       0.514–0.540 ms |
| Node 22 / reorder 500 panels, p95   |       3.383–3.416 ms |
| Node 22 / hit test 100 nodes, mean  |       5.072–5.173 µs |
| Node 22 / hit test 500 nodes, mean  |     27.316–27.564 µs |
| Node 22 / hit test 1000 nodes, mean |     56.490–56.596 µs |
| Node 24 / 10,000 kernel commands    | 1585.350–1611.110 ms |
| Node 24 / reorder 50 panels, p95    |       0.372–0.390 ms |
| Node 24 / reorder 500 panels, p95   |       2.517–2.532 ms |
| Node 24 / hit test 100 nodes, mean  |       3.846–3.954 µs |
| Node 24 / hit test 500 nodes, mean  |     20.156–20.390 µs |
| Node 24 / hit test 1000 nodes, mean |     41.773–42.052 µs |

## Raw evidence and reproduction

All JSON samples and source manifests are checked in under docs/benchmarks/2026-09-28. The SHA256SUMS file identifies the retained bytes. The workflow artifacts retain the original reports without formatting changes.

```bash
pnpm install --frozen-lockfile
pnpm build:packages
for repeat in 1 2 3; do
  for benchmark in scripts/benchmark-*.mjs; do
    node "$benchmark"
  done
done
pnpm exec playwright install --with-deps chromium
node scripts/benchmarks/drop-measurement-browser.mjs
node scripts/update-performance-report.mjs --check
```

## Audit decisions retained

The direct table-order and lookup-map-to-cursor experiments were not merged. Their complete-workload gains were not repeatable. The invalidation and header-index changes retain their small-workload controls; a large-layout gain is not a claim that every call is faster.
