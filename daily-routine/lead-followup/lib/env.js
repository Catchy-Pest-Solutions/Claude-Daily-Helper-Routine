// Loads the repo's .env if there is one (local runs), then reads required
// variables. In the routine they come from the environment settings.
const fs = require('node:fs');
const path = require('node:path');

const ENV_FILE = path.join(__dirname, '..', '..', '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // unreadable .env; rely on the environment
  }
}

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const loadConfig = () => JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

// --name value pairs and bare --flags.
function parseArgs(argv, { values = [], flags = [] } = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, '');
    if (flags.includes(name)) args[name] = true;
    else if (values.includes(name) && argv[i + 1] !== undefined) args[name] = argv[++i];
    else throw new Error(`unknown or incomplete option: ${argv[i]}`);
  }
  return args;
}

module.exports = { requireEnv, loadConfig, parseArgs, CONFIG_FILE };
