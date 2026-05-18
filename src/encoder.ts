import * as path from 'path';
import * as protobuf from 'protobufjs';

export interface Reading {
  labels: Record<string, string>;
  metric: string;
  value: number;
  units: string;
  timestamp: number;
}

export type EncodeFunction = (reading: Reading) => Buffer | Promise<Buffer>;

export interface EncodingConfig {
  type: 'json' | 'protobuf';
  protoFile?: string;
  messageType?: string;
  fieldMap?: Record<string, string>;
}

function applyFieldMap(
  reading: Reading,
  fieldMap: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!fieldMap) {
    return { ...reading.labels, ...reading };
  }
  const flat: Record<string, unknown> = { ...reading.labels, ...reading };
  const mapped: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(fieldMap)) {
    if (flat[from] !== undefined) {
      mapped[to] = flat[from];
    }
  }
  // Pass through unmapped fields
  for (const [k, v] of Object.entries(flat)) {
    if (!fieldMap[k]) mapped[k] = v;
  }
  return mapped;
}

export function buildEncoder(config: EncodingConfig): EncodeFunction {
  if (config.type === 'json') {
    return (reading) => Buffer.from(JSON.stringify(applyFieldMap(reading, config.fieldMap)));
  }

  if (!config.protoFile) {
    throw new Error('encoding.protoFile is required when encoding.type is "protobuf"');
  }
  if (!config.messageType) {
    throw new Error('encoding.messageType is required when encoding.type is "protobuf"');
  }

  const protoFile    = path.resolve(config.protoFile);
  const messageType  = config.messageType;
  const fieldMap     = config.fieldMap;

  let cachedType: protobuf.Type | null = null;

  return async (reading) => {
    if (!cachedType) {
      const root = await protobuf.load(protoFile);
      cachedType = root.lookupType(messageType);
    }
    const msg    = applyFieldMap(reading, fieldMap);
    const errMsg = cachedType.verify(msg);
    if (errMsg) throw new Error(`Protobuf verify failed: ${errMsg}`);
    return Buffer.from(cachedType.encode(cachedType.create(msg)).finish());
  };
}

export const jsonEncoder: EncodeFunction = (reading) =>
  Buffer.from(JSON.stringify({ ...reading.labels, ...reading }));
