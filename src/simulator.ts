import * as mqtt from 'mqtt';
import { SimulatorConfig, SourceConfig, MetricConfig, resolveTopicTemplate } from './config';
import { createSensorState, nextValue, advanceBias, SensorState } from './sensors';
import { EncodeFunction } from './encoder';
import { ScenarioId, SCENARIO_DETAIL, scenarioValue } from './scenarios';
import { EffectConfig, EffectState, computeBias, parseEffectCommand, applyEffect } from './effects';
import { logger } from './logger';

export interface MetricSnapshot {
  labels: Record<string, string>;
  metric: string;
  units: string;
  value: number | null;
  lastPublishedAt: number | null;
}

export interface StateSnapshot {
  scenario: ScenarioId;
  metrics: MetricSnapshot[];
}

export interface Simulator {
  stop(): void;
  setScenario(id: ScenarioId, sourceKey?: string, durationSeconds?: number): void;
  getScenario(sourceKey?: string): ScenarioId;
  getState(): StateSnapshot;
  getEffectStates(): Record<string, EffectState>;
}

interface ScenarioControl {
  active: ScenarioId;
  ticks: number[];
}

interface SourceEntry {
  config: SourceConfig;
  states: SensorState[];
  effectConfigs: EffectConfig[];
  effectState: EffectState;
  scenario: ScenarioControl;
  topic: string;
}

export function startSimulator(
  config: SimulatorConfig,
  client: mqtt.MqttClient,
  encode: EncodeFunction,
): Simulator {
  const timers: ReturnType<typeof setInterval>[] = [];
  const revertTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const entries = new Map<string, SourceEntry>();

  for (const source of config.sources) {
    const key   = JSON.stringify(source.labels);
    const topic = resolveTopicTemplate(source.topic, source.labels);
    const states = source.metrics.map((m) =>
      createSensorState({ ...m, intervalMs: m.intervalMs ?? config.publishIntervalMs }),
    );

    entries.set(key, {
      config:        source,
      states,
      effectConfigs: source.effects ?? [],
      effectState:   {},
      scenario:      { active: 'normal', ticks: new Array(source.metrics.length).fill(0) },
      topic,
    });

    // Subscribe to inbound commands on the reverse topic: topic + "/cmd"
    const cmdTopic = `${topic}/cmd`;
    client.subscribe(cmdTopic, (err) => {
      if (err) logger.error(`[sim] subscribe error ${cmdTopic}:`, err);
    });
  }

  // Handle inbound MQTT command messages
  client.on('message', (topic: string, payload: Buffer) => {
    if (!topic.endsWith('/cmd')) return;
    const baseTopic = topic.slice(0, -'/cmd'.length);

    let raw: unknown;
    try { raw = JSON.parse(payload.toString()); } catch { return; }

    for (const entry of entries.values()) {
      if (entry.topic === baseTopic) {
        const cmd = parseEffectCommand(raw);
        if (cmd) {
          entry.effectState = applyEffect(entry.effectState, cmd.effect, cmd.state);
          logger.info(`[effect] ${baseTopic} "${cmd.effect}" → ${cmd.state}`);
        }
        return;
      }
    }
  });

  // Schedule publish intervals for each metric in each source
  for (const entry of entries.values()) {
    for (let i = 0; i < entry.states.length; i++) {
      const state      = entry.states[i]!;
      const metricCfg  = entry.config.metrics[i]!;
      const intervalMs = state.config.intervalMs;

      const timer = setInterval(
        () => publishMetric(entry, i, metricCfg, state, client, encode),
        intervalMs,
      );
      timers.push(timer);
    }
  }

  const sourceCount = entries.size;
  const metricCount = [...entries.values()].reduce((n, e) => n + e.states.length, 0);
  logger.info(`[sim] started ${metricCount} metric(s) across ${sourceCount} source(s) | scenario: normal`);

  function applyScenario(id: ScenarioId, sourceKey?: string, durationSeconds?: number) {
    const targets = sourceKey ? [sourceKey] : [...entries.keys()];

    for (const key of targets) {
      const entry = entries.get(key);
      if (!entry) continue;
      const sc = entry.scenario;
      if (id === sc.active && !durationSeconds) continue;
      sc.active = id;
      sc.ticks.fill(0);

      const existing = revertTimers.get(key);
      if (existing) { clearTimeout(existing); revertTimers.delete(key); }

      logger.info(`\n[scenario:${entry.topic}] → ${id}`);
      logger.info(`               ${SCENARIO_DETAIL[id]}`);

      if (durationSeconds && durationSeconds > 0) {
        logger.info(`               Auto-reverts in ${durationSeconds}s\n`);
        const t = setTimeout(() => {
          revertTimers.delete(key);
          applyScenario('normal', key);
          logger.info(`[scenario:${entry.topic}] auto-reverted to normal\n`);
        }, durationSeconds * 1_000);
        revertTimers.set(key, t);
      } else {
        logger.info('');
      }
    }
  }

  return {
    stop() {
      for (const t of timers) clearInterval(t);
      for (const t of revertTimers.values()) clearTimeout(t);
      logger.info('[sim] stopped');
    },

    setScenario(id, sourceKey, durationSeconds) {
      applyScenario(id, sourceKey, durationSeconds);
    },

    getScenario(sourceKey?) {
      if (sourceKey) return entries.get(sourceKey)?.scenario.active ?? 'normal';
      const actives = [...entries.values()].map((e) => e.scenario.active);
      return actives.every((a) => a === actives[0]) ? (actives[0] ?? 'normal') : 'normal';
    },

    getState(): StateSnapshot {
      const firstScenario = [...entries.values()][0]?.scenario.active ?? 'normal';
      const metrics: MetricSnapshot[] = [];
      for (const entry of entries.values()) {
        for (let i = 0; i < entry.states.length; i++) {
          const s = entry.states[i]!;
          metrics.push({
            labels:          entry.config.labels,
            metric:          entry.config.metrics[i]!.name,
            units:           entry.config.metrics[i]!.units,
            value:           s.lastValue,
            lastPublishedAt: s.lastPublishedAt,
          });
        }
      }
      return { scenario: firstScenario, metrics };
    },

    getEffectStates(): Record<string, EffectState> {
      const out: Record<string, EffectState> = {};
      for (const entry of entries.values()) {
        out[entry.topic] = entry.effectState;
      }
      return out;
    },
  };
}

async function publishMetric(
  entry: SourceEntry,
  metricIndex: number,
  metricCfg: MetricConfig,
  state: SensorState,
  client: mqtt.MqttClient,
  encode: EncodeFunction,
): Promise<void> {
  const span       = state.resolved.max - state.resolved.min;
  const targetBias = computeBias(entry.effectConfigs, entry.effectState, metricCfg.name, span);
  advanceBias(state, targetBias);

  const sc       = entry.scenario;
  const tick     = sc.ticks[metricIndex] ?? 0;
  const override = scenarioValue(sc.active, state.resolved, tick, Math.random());

  let value: number;
  if (override !== null) {
    value = Math.round((override + state.currentBias) * 100) / 100;
  } else {
    value = nextValue(state, state.currentBias);
  }

  if (sc.active !== 'normal') {
    sc.ticks[metricIndex] = tick + 1;
  }

  state.lastValue       = value;
  state.lastPublishedAt = Date.now();

  try {
    const buf = await encode({
      labels:    entry.config.labels,
      metric:    metricCfg.name,
      value,
      units:     metricCfg.units,
      timestamp: state.lastPublishedAt,
    });

    await client.publishAsync(entry.topic, buf, { qos: 0 });

    const scenarioTag = sc.active !== 'normal' ? ` [${sc.active}]` : '';
    const biasTag     = state.currentBias !== 0
      ? ` (bias ${state.currentBias > 0 ? '+' : ''}${state.currentBias.toFixed(2)})`
      : '';
    logger.debug(`[${metricCfg.name}] ${value.toFixed(2)} ${metricCfg.units} → ${entry.topic}${scenarioTag}${biasTag}`);
  } catch (err) {
    logger.error(`[sim] publish error for ${metricCfg.name}:`, err);
  }
}
