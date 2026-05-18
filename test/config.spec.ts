import { strict as assert } from 'assert';
import * as path from 'path';
import { loadConfig, resolveTopicTemplate } from '../src/config';

const minimalYaml = path.join(__dirname, '..', 'examples', 'minimal.yaml');

describe('loadConfig', () => {
  it('loads minimal.yaml successfully', () => {
    const cfg = loadConfig(minimalYaml);
    assert.equal(cfg.sources.length, 1);
    assert.equal(cfg.sources[0]!.metrics.length, 1);
    assert.equal(cfg.sources[0]!.metrics[0]!.name, 'temperature');
  });

  it('defaults encoding to json', () => {
    const cfg = loadConfig(minimalYaml);
    assert.equal(cfg.encoding.type, 'json');
  });

  it('respects MQTT_HOST env override', () => {
    process.env['MQTT_HOST'] = 'broker.example.com';
    const cfg = loadConfig(minimalYaml);
    assert.equal(cfg.mqtt.host, 'broker.example.com');
    delete process.env['MQTT_HOST'];
  });

  it('throws if no sources defined', () => {
    assert.throws(() => loadConfig('/nonexistent/path.yaml'));
  });
});

describe('resolveTopicTemplate', () => {
  it('substitutes label keys', () => {
    const t = resolveTopicTemplate('{org}/{device}/metrics', { org: 'acme', device: 'node-1' });
    assert.equal(t, 'acme/node-1/metrics');
  });

  it('leaves unknown placeholders as-is', () => {
    const t = resolveTopicTemplate('{org}/{unknown}/metrics', { org: 'acme' });
    assert.equal(t, 'acme/unknown/metrics');
  });
});
