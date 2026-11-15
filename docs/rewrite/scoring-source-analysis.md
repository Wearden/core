# Percentage rounding source analysis

The legacy backend Dockerfile selects Python3.12. Its services/scoring.py calculates round(passed *100 / total,1) and round(earned *100 / possible,1). Multiplication of the integer numerator precedes true division. Valid reports have at most10000 findings and known weights1..4, so these integer products are exactly representable as binary64.

The previous Go helper multiplied by1000 before division, rounded the resulting binary float to an integer and divided by10. This changes intermediate rounding and can move a value across a decimal boundary. Ties-to-even alone does not make those operation sequences equivalent.

The updated wire.Score preserves numerator*100/denominator. It then uses strconv.FormatFloat with fixed format, one fractional digit and64-bit precision, followed by strconv.ParseFloat at64-bit precision. The standard-library decimal implementation and API documentation were inspected locally: decimal midpoint rounding is unbiased, and parsing selects the nearest binary float. The normal CPython3.12 double_round path likewise rounds through a decimal representation and converts that representation back to double. These are source-level reasons for the implementation choice, not a claim of an executed differential comparison.

Counts exclude error/not_applicable. Zero eligible findings still produce null scores. Authoritative severity validation remains required before scoring. No replacement low score is returned if the internal formatted-decimal invariant fails; that impossible conversion error fails explicitly instead of reporting a plausible percentage.

Primary references inspected on2026-11-15: [Python3.12 round](https://docs.python.org/3.12/library/functions.html#round), [CPython3.12 floatobject.c double_round](https://github.com/python/cpython/blob/v3.12.0/Objects/floatobject.c#L895). Go strconv.FormatFloat/ParseFloat documentation and src/strconv/decimal.go were inspected through the installed Go toolchain without running numerical examples.

Both Windows and Linux package-tree compilation passed after this source change. No tests, Python application imports, numerical probes, database connection or application startup were executed. Exotic CPython builds using their nonstandard fallback conversion path were not selected by the legacy Dockerfile and are not asserted equivalent here.
