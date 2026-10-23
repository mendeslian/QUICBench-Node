import http from 'k6/http';
import { check } from 'k6';

import { buildOptions, handleSummary, trackProto } from './lib/config.js';

const bodyBytes = Number(__ENV.BODY_BYTES || 102_400);
const payload = new ArrayBuffer(bodyBytes);
const { options: builtOptions, baseUrl } = buildOptions();

export const options = builtOptions;
export { handleSummary };

export default function () {
  const res = http.post(`${baseUrl}/bench/echo`, payload, {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  trackProto(res);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'bytes echoed': (r) => r.json('bytes') === bodyBytes,
  });
}
