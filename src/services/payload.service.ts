import { randomBytes } from 'node:crypto';

export const PAYLOAD_SIZES = {
  '1kb': 1024,
  '100kb': 102_400,
  '1mb': 1_048_576,
} as const;

export type PayloadSize = keyof typeof PAYLOAD_SIZES;

export const payloadSizes = Object.keys(PAYLOAD_SIZES) as PayloadSize[];

const payloads = new Map<PayloadSize, Buffer>();

for (const [size, bytes] of Object.entries(PAYLOAD_SIZES)) {
  payloads.set(size as PayloadSize, randomBytes(bytes));
}

export function getPayload(size: string): Buffer | null {
  if (!(size in PAYLOAD_SIZES)) {
    return null;
  }

  return payloads.get(size as PayloadSize) ?? null;
}

export function getPayloadByteLength(size: PayloadSize): number {
  return PAYLOAD_SIZES[size];
}
