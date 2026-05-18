# mqtt-scenario-sim

A configurable MQTT sensor simulator with built-in test scenarios. Publish synthetic sensor data over MQTT — as JSON or protobuf — without real hardware.

Define your sources with any labels you want. Wire up any MQTT topic template. Switch between test scenarios over HTTP to drive your alert and pipeline logic.

---

## Quick start

```bash
npx mqtt-scenario-sim --config examples/minimal.yaml
```

Requires a running MQTT broker (e.g. `docker run -p 1883:1883 eclipse-mosquitto`).

---

## Scenarios

The real differentiator. Switch your entire simulator into a controlled test state at any time — no restarts.

| ID | Key | What it does |
|---|---|---|
| 0 | `normal` | Each metric runs its configured mode |
| 1 | `out_of_range` | All metrics 30% above max — tests breach detection |
| 2 | `trending_to_breach` | Rising toward max — tests early-warning alerts |
| 3 | `stable_healthy` | Held at midpoint ideal — tests steady-state |
| 4 | `recovery` | Starts out-of-range, decays to ideal over ~5 min |
| 5 | `oscillating` | ±10% swing — tests flapping suppression |

```bash
# Activate a scenario
curl -X POST http://localhost:4000/scenario/1

# With auto-revert after 60 seconds
curl -X POST "http://localhost:4000/scenario/4?durationSeconds=60"

# Target a single source by its labels key
curl -X POST "http://localhost:4000/scenario/2?sourceKey=%7B%22device%22%3A%22node-1%22%7D"

# Check current scenario
curl http://localhost:4000/scenario

# Back to normal
curl -X POST http://localhost:4000/scenario/0
```

---

## YAML config

```yaml
mqtt:
  host: localhost
  port: 1883

publishIntervalMs: 5000

encoding:
  type: json          # or "protobuf" (see Protobuf section)

sources:
  - labels:           # fully freeform — any keys you want
      building: hq
      floor: "3"
      zone: east
    topic: "{building}/{floor}/{zone}/metrics"   # template using label keys
    metrics:
      - name: temperature
        units: "°C"
        mode: sinusoidal       # sinusoidal | drift | normal | spike
        range: { low: 18, high: 28 }
        periodSeconds: 3600    # optional
      - name: humidity
        units: "%"
        mode: drift
        range: { low: 30, high: 70 }
    effects:           # optional — external things that bias metric readings
      - name: hvac
        effects:
          temperature: -0.40   # fraction of range span, negative = reduce
          humidity: -0.20
```

### Sensor modes

| Mode | Description |
|---|---|
| `sinusoidal` | Smooth oscillation over `periodSeconds` |
| `normal` | Gaussian noise around baseline |
| `drift` | Slow random walk that bounces at range edges |
| `spike` | Normal noise with random anomaly spikes |

### Effects

Effects let you simulate external influences on metric readings. Send a command to `{topic}/cmd`:

```json
{ "effect": "hvac", "state": true }
```

Each effect's `effects` map specifies bias as a fraction of the metric's span. `-0.40` on temperature with a span of 10°C = -4°C bias.

---

## Protobuf

```yaml
encoding:
  type: protobuf
  protoFile: ./my.proto
  messageType: myapp.SensorReading
  fieldMap:                   # optional — remap internal fields to proto field names
    metric: sensor_name
    value: reading_value
    timestamp: recorded_at
```

Internal fields available for mapping: `metric`, `value`, `units`, `timestamp`, plus any label key (e.g. `building`, `floor`).

---

## HTTP API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Status, uptime, scenario |
| `GET` | `/scenario` | Current scenario name + description |
| `POST` | `/scenario/:id` | Activate scenario (0–5 or name). Query: `durationSeconds`, `sourceKey` |
| `GET` | `/state` | Last published value per metric |
| `GET` | `/effects` | Current effect state per source |

---

## Env vars

| Variable | Default | Description |
|---|---|---|
| `MQTT_HOST` | `localhost` | MQTT broker host |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `PUBLISH_INTERVAL_MS` | `5000` | Default publish interval |
| `ENCODING` | `json` | `json` or `protobuf` |
| `PROTO_FILE` | — | Path to `.proto` file |
| `PROTO_MESSAGE_TYPE` | — | Fully-qualified proto message type |
| `PROTO_FIELD_MAP` | — | JSON string field map |
| `CONFIG_PATH` | `examples/minimal.yaml` | Path to YAML config |
| `PORT` | `4000` | HTTP control plane port |

---

## Examples

- [`examples/minimal.yaml`](examples/minimal.yaml) — 1 source, 1 metric, JSON
- [`examples/greenhouse.yaml`](examples/greenhouse.yaml) — multi-source, multi-metric IoT example
- [`examples/custom-proto.yaml`](examples/custom-proto.yaml) — protobuf with fieldMap

---

## Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY examples/ ./examples/
ENV CONFIG_PATH=examples/minimal.yaml
CMD ["node", "dist/cli.js"]
```

---

## License

MIT
