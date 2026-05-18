import { strict as assert } from 'assert';
import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';
import { startSimulator, PublishEvent } from '../src/simulator';
import { SimulatorConfig } from '../src/config';
import { jsonEncoder } from '../src/encoder';

function makeConfig(overrides: Partial<SimulatorConfig> = {}): SimulatorConfig {
  return {
    mqtt: { host: 'localhost', port: 1883 },
    publishIntervalMs: 50,
    encoding: { type: 'json' },
    sources: [{
      labels: { device: 'test-node' },
      topic: 'test/metrics',
      metrics: [{ name: 'temperature', units: '°C', mode: 'normal', range: { low: 0, high: 100 } }],
    }],
    ...overrides,
  };
}

function makeMockClient() {
  const emitter = new EventEmitter();
  const published: { topic: string; payload: Buffer }[] = [];
  const client = {
    subscribe: (_t: string, cb: (err: null) => void) => cb(null),
    on: (event: string, handler: (...args: unknown[]) => void) => emitter.on(event, handler),
    publishAsync: async (topic: string, payload: Buffer) => { published.push({ topic, payload }); },
    published,
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
  };
  return client as unknown as mqtt.MqttClient & {
    published: typeof published;
    emit: (event: string, ...args: unknown[]) => boolean;
  };
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

describe('startSimulator', () => {
  describe('initial state', () => {
    it('returns normal scenario by default', () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      assert.equal(sim.getScenario(), 'normal');
      sim.stop();
    });

    it('getState returns correct metric structure before first publish', () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      const state = sim.getState();
      assert.equal(state.scenario, 'normal');
      assert.equal(state.metrics.length, 1);
      assert.equal(state.metrics[0]!.metric, 'temperature');
      assert.equal(state.metrics[0]!.units, '°C');
      assert.deepEqual(state.metrics[0]!.labels, { device: 'test-node' });
      assert.equal(state.metrics[0]!.value, null);
      sim.stop();
    });

    it('getEffectStates returns empty effect state per topic', () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      assert.deepEqual(sim.getEffectStates(), { 'test/metrics': {} });
      sim.stop();
    });
  });

  describe('scenario control', () => {
    it('setScenario updates active scenario', () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      sim.setScenario('out_of_range');
      assert.equal(sim.getScenario(), 'out_of_range');
      sim.stop();
    });

    it('setScenario with sourceKey only affects the targeted source', () => {
      const config = makeConfig({
        sources: [
          { labels: { device: 'a' }, topic: 'a/metrics', metrics: [{ name: 'temp', units: '°C', mode: 'normal', range: { low: 0, high: 100 } }] },
          { labels: { device: 'b' }, topic: 'b/metrics', metrics: [{ name: 'temp', units: '°C', mode: 'normal', range: { low: 0, high: 100 } }] },
        ],
      });
      const sim = startSimulator(config, makeMockClient(), jsonEncoder);
      const keyA = JSON.stringify({ device: 'a' });
      const keyB = JSON.stringify({ device: 'b' });
      sim.setScenario('out_of_range', keyA);
      assert.equal(sim.getScenario(keyA), 'out_of_range');
      assert.equal(sim.getScenario(keyB), 'normal');
      sim.stop();
    });

    it('setScenario with durationSeconds auto-reverts to normal', async () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      sim.setScenario('stable_healthy', undefined, 0.1); // 100ms
      assert.equal(sim.getScenario(), 'stable_healthy');
      await sleep(200);
      assert.equal(sim.getScenario(), 'normal');
      sim.stop();
    });
  });

  describe('publish loop', () => {
    it('publishes metrics on the configured interval', async () => {
      const client = makeMockClient();
      const sim = startSimulator(makeConfig(), client, jsonEncoder);
      await sleep(150);
      sim.stop();
      assert.ok(client.published.length > 0, 'expected at least one publish');
      assert.equal(client.published[0]!.topic, 'test/metrics');
    });

    it('state reflects last published value after a tick', async () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      await sleep(150);
      const state = sim.getState();
      sim.stop();
      assert.ok(state.metrics[0]!.value !== null, 'expected a published value');
      assert.ok(typeof state.metrics[0]!.value === 'number');
    });
  });

  describe('onPublish', () => {
    it('fires listener for each published metric', async () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      const events: PublishEvent[] = [];
      sim.onPublish(e => events.push(e));
      await sleep(150);
      sim.stop();
      assert.ok(events.length > 0);
      assert.equal(events[0]!.metric, 'temperature');
      assert.equal(events[0]!.topic, 'test/metrics');
      assert.equal(typeof events[0]!.value, 'number');
      assert.equal(events[0]!.scenario, 'normal');
    });

    it('unsubscribe stops listener from receiving further events', async () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      const events: PublishEvent[] = [];
      const unsub = sim.onPublish(e => events.push(e));
      await sleep(75);
      unsub();
      const countAtUnsub = events.length;
      await sleep(75);
      sim.stop();
      assert.equal(events.length, countAtUnsub);
    });

    it('returns an unsubscribe function', () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      const unsub = sim.onPublish(() => {});
      assert.equal(typeof unsub, 'function');
      sim.stop();
    });
  });

  describe('effect commands', () => {
    it('activates effect on matching MQTT command message', () => {
      const config = makeConfig({
        sources: [{
          labels: { device: 'test-node' },
          topic: 'test/metrics',
          metrics: [{ name: 'temperature', units: '°C', mode: 'normal', range: { low: 0, high: 100 } }],
          effects: [{ name: 'hvac', effects: { temperature: -0.5 } }],
        }],
      });
      const client = makeMockClient();
      const sim = startSimulator(config, client, jsonEncoder);
      client.emit('message', 'test/metrics/cmd', Buffer.from(JSON.stringify({ effect: 'hvac', state: true })));
      assert.deepEqual(sim.getEffectStates()['test/metrics'], { hvac: true });
      sim.stop();
    });

    it('ignores malformed command messages', () => {
      const client = makeMockClient();
      const sim = startSimulator(makeConfig(), client, jsonEncoder);
      client.emit('message', 'test/metrics/cmd', Buffer.from('not json'));
      client.emit('message', 'test/metrics/cmd', Buffer.from(JSON.stringify({ wrong: 'shape' })));
      assert.deepEqual(sim.getEffectStates()['test/metrics'], {});
      sim.stop();
    });
  });

  describe('stop', () => {
    it('does not throw', () => {
      const sim = startSimulator(makeConfig(), makeMockClient(), jsonEncoder);
      assert.doesNotThrow(() => sim.stop());
    });

    it('stops publishing after stop is called', async () => {
      const client = makeMockClient();
      const sim = startSimulator(makeConfig(), client, jsonEncoder);
      await sleep(75);
      sim.stop();
      const countAtStop = client.published.length;
      await sleep(75);
      assert.equal(client.published.length, countAtStop);
    });
  });
});
