import http from 'k6/http';
import { check } from 'k6';

import { buildOptions, handleSummary, trackProto } from './lib/config.js';

const { options: builtOptions, baseUrl } = buildOptions();

export const options = builtOptions;
export { handleSummary };

export default function () {
  const res = http.get(`${baseUrl}/bench/ping`);
  trackProto(res);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'body ok': (r) => r.json('ok') === true,
  });
}
