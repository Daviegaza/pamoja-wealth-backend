# Load tests (k6)

## Install
```
brew install k6      # macOS
# or
sudo apt install k6  # Linux
```

## Smoke (30s, 1 VU)
```
BASE_URL=http://localhost:3000/api/v1 k6 run load/smoke.js
```

## Contribute (8 min, ramps to 100 VU)
Pre-provision a test user + chama membership, then:
```
BASE_URL=https://api.staging.pamojawealth.app/v1 \
K6_TEST_TOKEN=eyJhbGc... \
K6_CHAMA_ID=abc-123 \
k6 run load/contribute.js
```

## Thresholds
- `smoke`: p95 < 500ms, failure rate < 1%
- `contribute`: p95 < 800ms, p99 < 1.5s, contribute-specific p95 < 1s

## CI gate
```
k6 run --quiet load/smoke.js  # exits non-zero if thresholds miss
```
