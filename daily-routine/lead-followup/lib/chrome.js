// Headless Chromium over the DevTools protocol, with no npm packages: the
// cloud image ships Playwright's Chromium under /opt/pw-browsers, and Node 22
// has a built-in WebSocket. Used to turn the filled HTML templates into the
// quote card JPG and the quote PDF.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const roots = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).sort().reverse()) {
      if (dir.startsWith('chromium_headless_shell-')) candidates.push(path.join(root, dir, 'chrome-linux', 'headless_shell'));
      if (dir.startsWith('chromium-')) candidates.push(path.join(root, dir, 'chrome-linux', 'chrome'));
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      candidates.push(execFileSync('which', [name], { encoding: 'utf8' }).trim());
    } catch {
      // not on PATH
    }
  }
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chromium not found (set CHROME_PATH)');
  return found;
}

async function launch() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-chrome-'));
  const proc = spawn(
    findChrome(),
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--font-render-hinting=none',
      '--allow-file-access-from-files',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDir}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chromium did not start within 20 s')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited early (code ${code})`));
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not connect to Chromium'));
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const waitFor = (method, sessionId, ms = 30000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), ms);
      listeners.push(function l(msg) {
        if (msg.method === method && msg.sessionId === sessionId) {
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(l), 1);
          resolve(msg.params);
        }
      });
    });

  // Opens an HTML file at the given viewport size and waits for fonts and images.
  async function open(htmlPath, { width, height }) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    const loaded = waitFor('Page.loadEventFired', sessionId);
    await send('Page.navigate', { url: `file://${path.resolve(htmlPath)}` }, sessionId);
    await loaded;
    await send(
      'Runtime.evaluate',
      {
        expression: 'Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]).then(() => true)',
        awaitPromise: true,
      },
      sessionId,
    );
    return {
      evaluate: async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)).result.value,
      screenshotJpeg: async (quality) => {
        const { data } = await send(
          'Page.captureScreenshot',
          { format: 'jpeg', quality, clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: false },
          sessionId,
        );
        return Buffer.from(data, 'base64');
      },
      pdf: async () => {
        const { data } = await send(
          'Page.printToPDF',
          { printBackground: true, preferCSSPageSize: true, paperWidth: 8.5, paperHeight: 11, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 },
          sessionId,
        );
        return Buffer.from(data, 'base64');
      },
      close: () => send('Target.closeTarget', { targetId }),
    };
  }

  async function close() {
    try {
      await send('Browser.close');
    } catch {
      // already gone
    }
    ws.close();
    proc.kill('SIGKILL');
    fs.rmSync(userDir, { recursive: true, force: true });
  }

  return { open, close };
}

// Page count of a PDF Chromium wrote (each page object is "/Type /Page").
function pdfPageCount(buf) {
  return (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
}

module.exports = { launch, findChrome, pdfPageCount };
