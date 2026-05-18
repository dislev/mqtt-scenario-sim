#!/usr/bin/env node
import * as readline from 'readline';
import * as mqtt from 'mqtt';
import * as path from 'path';
import express from 'express';
import { loadConfig } from './config';
import { buildEncoder, jsonEncoder } from './encoder';
import { startSimulator, StateSnapshot, PublishEvent } from './simulator';
import { ScenarioId, SCENARIO_KEYS, SCENARIO_LABELS, SCENARIO_DETAIL } from './scenarios';
import { logger } from './logger';

const PORT = parseInt(process.env['PORT'] ?? '4000', 10);

const logLevelArg = process.argv.find((a) => a.startsWith('--log-level='))?.slice('--log-level='.length)
  ?? (process.argv.indexOf('--log-level') !== -1 ? process.argv[process.argv.indexOf('--log-level') + 1] : undefined)
  ?? process.env['LOG_LEVEL'];
if (logLevelArg) logger.setLevel(logLevelArg);

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: mqtt-scenario-sim [options]

Options:
  --config <path>       Path to YAML config file (default: examples/minimal.yaml)
  --log-level <level>   Log verbosity: silent | error | warn | info | debug  (default: info)
  -h, --help            Show this help message

Env vars:
  MQTT_HOST             MQTT broker host            (default: localhost)
  MQTT_PORT             MQTT broker port            (default: 1883)
  PUBLISH_INTERVAL_MS   Publish interval in ms      (default: 5000)
  ENCODING              json | protobuf             (default: json)
  PROTO_FILE            Path to .proto file
  PROTO_MESSAGE_TYPE    Fully-qualified message type
  PROTO_FIELD_MAP       JSON string field map
  CONFIG_PATH           Path to YAML config file    (default: examples/minimal.yaml)
  PORT                  HTTP control plane port     (default: 4000)
  LOG_LEVEL             Log verbosity level         (default: info)

HTTP API (default port 4000):
  GET  /stream          SSE stream of live metric publishes
  GET  /status          Full snapshot: uptime, scenario, readings, effects
  GET  /health          Status, uptime, source/metric counts, scenario
  GET  /scenario        Current scenario name + description
  POST /scenario/:id    Activate scenario by ID (0–5) or name
  GET  /state           Last published value per metric
  GET  /effects         Current effect state per source

Scenarios:
  0 / normal              Each metric runs its configured mode
  1 / out_of_range        All metrics 30% above max
  2 / trending_to_breach  Rising toward max
  3 / stable_healthy      Held at midpoint ideal
  4 / recovery            Starts out-of-range, decays to ideal over ~5 min
  5 / oscillating         ±10% swing around ideal

Examples:
  mqtt-scenario-sim --config examples/minimal.yaml
  mqtt-scenario-sim --config my.yaml --log-level debug
  `);
  process.exit(0);
}

function printMenu(): void {
  logger.info('\n┌─ Scenario control ──────────────────────────────────────────┐');
  for (const label of Object.values(SCENARIO_LABELS)) {
    logger.info(`│  ${label.padEnd(61)}│`);
  }
  logger.info('│                                                             │');
  logger.info('│  status / ?   show active scenario                         │');
  logger.info('│  help         re-print this menu                           │');
  logger.info('└─────────────────────────────────────────────────────────────┘\n');
}

function resolveScenarioId(input: string): ScenarioId | null {
  return SCENARIO_KEYS[input.trim().toLowerCase()] ?? null;
}

async function main(): Promise<void> {
  const configArg = process.argv.find((a) => a.startsWith('--config='))?.slice('--config='.length)
    ?? process.argv[process.argv.indexOf('--config') + 1];

  const configPath = configArg
    ? path.resolve(configArg)
    : process.env['CONFIG_PATH'];

  const config = loadConfig(configPath);

  const totalMetrics = config.sources.reduce((n, s) => n + s.metrics.length, 0);
  logger.info(
    `[init] ${config.sources.length} source(s) | ${totalMetrics} metric(s) | MQTT: ${config.mqtt.host}:${config.mqtt.port}`,
  );

  const encode = config.encoding.type === 'protobuf'
    ? buildEncoder(config.encoding)
    : jsonEncoder;

  const brokerUrl = `mqtt://${config.mqtt.host}:${config.mqtt.port}`;
  const client    = mqtt.connect(brokerUrl, { reconnectPeriod: 2000 });

  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('error', (err) => reject(err));
  });
  logger.info(`[mqtt] connected to ${brokerUrl}`);

  const sim = startSimulator(config, client, encode);

  // ── HTTP control plane ────────────────────────────────────────────────────
  const app       = express();
  const startTime = Date.now();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status:   'ok',
      sources:  config.sources.length,
      metrics:  totalMetrics,
      uptime:   Math.floor((Date.now() - startTime) / 1000),
      scenario: sim.getScenario(),
    });
  });

  app.get('/scenario', (_req, res) => {
    const id = sim.getScenario();
    res.json({ scenario: id, label: SCENARIO_LABELS[id], detail: SCENARIO_DETAIL[id] });
  });

  app.post('/scenario/:id', (req, res) => {
    const id = resolveScenarioId(req.params['id'] ?? '');
    if (!id) {
      res.status(400).json({
        error: `Unknown scenario "${req.params['id']}". Valid: ${Object.keys(SCENARIO_KEYS).join(', ')}`,
      });
      return;
    }
    const rawDuration  = req.query['durationSeconds'];
    const rawSourceKey = req.query['sourceKey'];
    const durationSeconds =
      typeof rawDuration === 'string' && rawDuration.length > 0
        ? parseInt(rawDuration, 10)
        : undefined;
    const sourceKey =
      typeof rawSourceKey === 'string' && rawSourceKey.length > 0
        ? rawSourceKey
        : undefined;

    sim.setScenario(id, sourceKey, durationSeconds && durationSeconds > 0 ? durationSeconds : undefined);
    res.json({
      ok: true,
      scenario: id,
      label: SCENARIO_LABELS[id],
      ...(sourceKey ? { sourceKey } : { appliedTo: 'all' }),
      ...(durationSeconds && durationSeconds > 0 ? { autoRevertAfterSeconds: durationSeconds } : {}),
    });
  });

  app.get('/state', (_req, res) => {
    res.json(sim.getState() as StateSnapshot);
  });

  app.get('/effects', (_req, res) => {
    res.json(sim.getEffectStates());
  });

  app.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsub = sim.onPublish((event: PublishEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on('close', unsub);
  });

  app.get('/status', (_req, res) => {
    const scenarioId = sim.getScenario();
    const state      = sim.getState() as StateSnapshot;
    res.json({
      status:    'ok',
      uptime:    Math.floor((Date.now() - startTime) / 1000),
      sources:   config.sources.length,
      metrics:   totalMetrics,
      scenario: {
        id:     scenarioId,
        label:  SCENARIO_LABELS[scenarioId],
        detail: SCENARIO_DETAIL[scenarioId],
      },
      readings: state.metrics,
      effects:  sim.getEffectStates(),
    });
  });

  const server = app.listen(PORT, () => {
    logger.info(`[http] :${PORT}`);
    logger.info(`       GET  /health  GET  /scenario  POST /scenario/:id`);
    logger.info(`       GET  /state   GET  /effects`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`[http] port ${PORT} in use — HTTP unavailable, sim still running`);
    } else {
      logger.error('[http] error:', err);
    }
  });

  // ── Stdin REPL ─────────────────────────────────────────────────────────────
  if (process.stdin.isTTY) {
    printMenu();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'scenario> ' });
    rl.prompt();
    rl.on('line', (line) => {
      const input = line.trim().toLowerCase();
      if (!input)                              { rl.prompt(); return; }
      if (input === 'help')                    { printMenu(); rl.prompt(); return; }
      if (input === 'status' || input === '?') {
        const id = sim.getScenario();
        logger.info(`[scenario] ${id} — ${SCENARIO_DETAIL[id]}`);
        rl.prompt(); return;
      }
      const id = resolveScenarioId(input);
      if (id) sim.setScenario(id);
      else    logger.info(`Unknown: "${input}". Type help for options.`);
      rl.prompt();
    });
    rl.on('close', () => logger.info('[repl] stdin closed'));
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = () => {
    logger.info('[shutdown] stopping...');
    sim.stop();
    client.end();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

main().catch((err) => {
  logger.error('[fatal]', err);
  process.exit(1);
});
