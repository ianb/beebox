# Scheduled Script Parsing

Parsing utilities for scheduled script duration and budget strings.

```ts setup
import { parseDuration, parseBudget } from "../src/schemas/scheduled-script.js";
```

## parseDuration

Parses human-readable duration strings into milliseconds. Supports `s` (seconds), `m` (minutes), `h` (hours), `d` (days), and fractional values.

```
parseDuration("30s")
=> 30000

parseDuration("5m")
=> 300000

parseDuration("4h")
=> 14400000

parseDuration("1d")
=> 86400000

parseDuration("1.5h")
=> 5400000
```

## parseBudget

Parses budget strings in the format `limit/window` — both are durations. A budget of `10m/5h` means "at most 10 minutes of runtime within any 5-hour window."

```
JSON.stringify(parseBudget("10m/5h"))
=> {"limitMs":600000,"windowMs":18000000}

JSON.stringify(parseBudget("30s/1m"))
=> {"limitMs":30000,"windowMs":60000}
```
