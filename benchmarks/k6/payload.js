import http from 'k6/http';
import { check } from 'k6';

import { buildOptions, handleSummary, trackProto } from './lib/config.js';

const size = (__ENV.SIZE || '1kb').toLowerCase();
const { options: builtOptions, baseUrl } = buildOptions();

export const options = builtOptions;
export { handleSummary };

export default function () {
  const res = http.get(`${baseUrl}/bench/payload/${size}`);
  trackProto(res);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'content-type binary': (r) =>
      String(r.headers['Content-Type'] || '').includes('octet-stream'),
  });
}
