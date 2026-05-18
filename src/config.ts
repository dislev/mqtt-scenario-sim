import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SensorMode, SensorRange } from './sensors';
import { EffectConfig } from './effects';
import { EncodingConfig } from './encoder';

export interface MetricConfig {
  name: string;
  units: string;
  mode: SensorMode;
  range: SensorRange;
  baseline?: number;
  amplitude?: number;
  periodSeconds?: number;
  driftRate?: number;
  min?: number;
  max?: number;
  intervalMs?: number;
  spikeProbability?: number;
  spikeMagnitude?: number;
}

export interface SourceConfig {
  labels: Record<string, string>;
  topic: string;
  metrics: MetricConfig[];
  effects?: EffectConfig[];
}

export interface SimulatorConfig {
  mqtt: {
    host: string;
    port: number;
  };
  publishIntervalMs: number;
  encoding: EncodingConfig;
  sources: SourceConfig[];
}

function resolveTopicTemplate(template: string, labels: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => labels[key] ?? key);
}

export { resolveTopicTemplate };

export function loadConfig(configPath?: string): SimulatorConfig {
  const filePath = configPath ?? path.join(__dirname, '..', 'examples', 'minimal.yaml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const cfg = yaml.load(raw) as Partial<SimulatorConfig>;

  const mqtt = {
    host: process.env['MQTT_HOST'] ?? cfg.mqtt?.host ?? 'localhost',
    port: process.env['MQTT_PORT']
      ? parseInt(process.env['MQTT_PORT'], 10)
      : (cfg.mqtt?.port ?? 1883),
  };

  const publishIntervalMs = process.env['PUBLISH_INTERVAL_MS']
    ? parseInt(process.env['PUBLISH_INTERVAL_MS'], 10)
    : (cfg.publishIntervalMs ?? 5000);

  const encodingType = (process.env['ENCODING'] ?? cfg.encoding?.type ?? 'json') as 'json' | 'protobuf';
  const encoding: EncodingConfig = {
    type: encodingType,
    protoFile:   process.env['PROTO_FILE']         ?? cfg.encoding?.protoFile,
    messageType: process.env['PROTO_MESSAGE_TYPE'] ?? cfg.encoding?.messageType,
    fieldMap:    process.env['PROTO_FIELD_MAP']
      ? JSON.parse(process.env['PROTO_FIELD_MAP'])
      : cfg.encoding?.fieldMap,
  };

  const sources: SourceConfig[] = (cfg.sources ?? []).map((s) => ({
    labels:  s.labels ?? {},
    topic:   s.topic ?? '',
    metrics: s.metrics ?? [],
    effects: s.effects,
  }));

  if (sources.length === 0) {
    throw new Error('Config must define at least one source.');
  }

  return { mqtt, publishIntervalMs, encoding, sources };
}
