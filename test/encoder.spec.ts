import { strict as assert } from 'assert';
import { buildEncoder, jsonEncoder } from '../src/encoder';
import type { Reading } from '../src/encoder';

const reading: Reading = {
  labels:    { room: 'lab', floor: '2' },
  metric:    'temperature',
  value:     22.5,
  units:     '°C',
  timestamp: 1700000000000,
};

describe('jsonEncoder', () => {
  it('encodes reading as JSON buffer', () => {
    const buf  = jsonEncoder(reading) as Buffer;
    const data = JSON.parse(buf.toString());
    assert.equal(data['metric'],    'temperature');
    assert.equal(data['value'],     22.5);
    assert.equal(data['room'],      'lab');
    assert.equal(data['floor'],     '2');
  });
});

describe('buildEncoder (json)', () => {
  it('applies fieldMap to output keys', () => {
    const encode = buildEncoder({
      type:     'json',
      fieldMap: { metric: 'sensor_name', value: 'reading_value' },
    });
    const buf  = encode(reading) as Buffer;
    const data = JSON.parse(buf.toString());
    assert.equal(data['sensor_name'],   'temperature');
    assert.equal(data['reading_value'], 22.5);
    assert.ok(!('metric' in data));
    assert.ok(!('value'  in data));
  });

  it('passes through unmapped fields', () => {
    const encode = buildEncoder({ type: 'json', fieldMap: { metric: 'name' } });
    const buf  = encode(reading) as Buffer;
    const data = JSON.parse(buf.toString());
    assert.equal(data['units'], '°C');
    assert.equal(data['room'],  'lab');
  });
});

describe('buildEncoder (protobuf)', () => {
  it('throws when protoFile is missing', () => {
    assert.throws(
      () => buildEncoder({ type: 'protobuf' }),
      /protoFile is required/,
    );
  });

  it('throws when messageType is missing', () => {
    assert.throws(
      () => buildEncoder({ type: 'protobuf', protoFile: './my.proto' }),
      /messageType is required/,
    );
  });
});
