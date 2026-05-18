#!/usr/bin/env node
import * as readline from 'readline';
import * as mqtt from 'mqtt';
import * as path from 'path';
import express from 'express';
import { loadConfig } from './config';
import { buildEncoder, jsonEncoder } from './encoder';
import { startSimulator, StateSnapshot } from './simulator';
import { ScenarioId, SCENARIO_KEYS, SCENARIO_LABELS, SCENARIO_DETAIL } from './scenarios';

const PORT = parseInt(process.env['PORT'] ?? '4000', 10);

function printMenu(): void {
  console.log('\n┌─ Scenario control ──────────────────────────────────────────┐');
  for (const label of Object.values(SCENARIO_LABELS)) {
    console.log(`│  ${label.padEnd(61)}│`);
  }
  console.log('│                                                             │');
  console.log('│  status / ?   show active scenario                         │');
  console.log('│  help         re-print this menu                           │');
  console.log('└─────────────────────────────────────────────────────────────┘\n');
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
  console.log(
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
  console.log(`[mqtt] connected to ${brokerUrl}`);

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

  const server = app.listen(PORT, () => {
    console.log(`[http] :${PORT}`);
    console.log(`       GET  /health  GET  /scenario  POST /scenario/:id`);
    console.log(`       GET  /state   GET  /effects`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[http] port ${PORT} in use — HTTP unavailable, sim still running`);
    } else {
      console.error('[http] error:', err);
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
        console.log(`[scenario] ${id} — ${SCENARIO_DETAIL[id]}`);
        rl.prompt(); return;
      }
      const id = resolveScenarioId(input);
      if (id) sim.setScenario(id);
      else    console.log(`Unknown: "${input}". Type help for options.`);
      rl.prompt();
    });
    rl.on('close', () => console.log('[repl] stdin closed'));
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = () => {
    console.log('[shutdown] stopping...');
    sim.stop();
    client.end();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
