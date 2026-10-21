// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is
// set when Node starts. Cloud sessions route traffic through the agent proxy
// (which is also what attaches any "network secrets" configured on the
// environment), so each script re-runs itself once with the flag set.
// Required first thing by prepare.js, render.js and send.js.
const { spawnSync } = require('node:child_process');

if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' },
  });
  process.exit(r.status ?? 1);
}
