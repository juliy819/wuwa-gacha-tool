import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.argv[2] ?? path.join(projectRoot, 'src-tauri', 'target', 'release', 'wuwa-gacha-tool.exe');
const port = 9400 + Math.floor(Math.random() * 400);
const reportPath = path.join(os.tmpdir(), `wuwa-startup-perf-${Date.now()}.json`);
const logPath = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'com.wuwa.gachatool', 'logs', 'wuwa-gacha-tool.log')
  : null;
const logOffset = logPath && fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;

const limits = {
  initialJavaScriptBytes: 440 * 1024,
  analyticsJavaScriptBytes: 650 * 1024,
  firstContentfulPaintMs: 500,
  scriptDurationMs: 400,
  layoutDurationMs: 300,
  commandDurationMs: {
    get_stats: 50,
    get_all_records: 75,
  },
};

const assetSizes = Object.fromEntries(
  fs.readdirSync(path.join(projectRoot, 'dist', 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => [name, fs.statSync(path.join(projectRoot, 'dist', 'assets', name)).size]),
);
const initialAsset = Object.entries(assetSizes).find(([name]) => /^index-[^.]+\.js$/.test(name));
const analyticsAsset = Object.entries(assetSizes).find(([name]) => name.startsWith('AnalyticsPage-'));

if (!fs.existsSync(executable)) {
  throw new Error(`Release executable not found: ${executable}. Run npm run perf:startup:build first.`);
}
if (!initialAsset || !analyticsAsset) {
  throw new Error('Expected Vite production assets were not found. Run npm run build first.');
}

const child = spawn(executable, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
  },
  stdio: 'ignore',
  windowsHide: true,
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findTarget() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && item.url.includes('tauri.localhost'));
      if (target) return target;
    } catch {}
    await sleep(25);
  }
  throw new Error('WebView2 CDP target was not found.');
}

function readNewLogLines() {
  if (!logPath || !fs.existsSync(logPath)) return [];
  const size = fs.statSync(logPath).size;
  if (size <= logOffset) return [];
  const handle = fs.openSync(logPath, 'r');
  const buffer = Buffer.alloc(size - logOffset);
  fs.readSync(handle, buffer, 0, buffer.length, logOffset);
  fs.closeSync(handle);
  return buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
}

function commandDurations(lines) {
  const result = {};
  for (const line of lines) {
    const match = line.match(/command=(get_stats|get_all_records).*?duration_ms=(\d+)/);
    if (!match) continue;
    result[match[1]] ??= [];
    result[match[1]].push(Number(match[2]));
  }
  return result;
}

let socket;
const failures = [];

try {
  const target = await findTarget();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  let nextId = 1;
  const pending = new Map();
  const traceEvents = [];
  const consoleErrors = [];
  let tracingCompleteResolve;
  const tracingComplete = new Promise((resolve) => { tracingCompleteResolve = resolve; });

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === 'Tracing.dataCollected') traceEvents.push(...message.params.value);
    if (message.method === 'Tracing.tracingComplete') tracingCompleteResolve();
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((argument) => argument.value ?? argument.description ?? '').join(' '));
    }
  };

  const send = (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  await Promise.all([
    send('Page.enable'),
    send('Runtime.enable'),
    send('Performance.enable'),
  ]);

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const data = window.__WUWA_STARTUP_PERF__ = { longTasks: [], paints: [], animationSnapshots: [] };
      const describe = (node) => {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        if (!element) return 'unknown';
        const classes = [...element.classList].join('.');
        return element.tagName.toLowerCase() + (classes ? '.' + classes : '');
      };
      for (const delay of [100, 200]) {
        setTimeout(() => data.animationSnapshots.push({
          delay,
          targets: document.getAnimations().map((animation) => describe(animation.effect?.target)),
        }), delay);
      }
      new PerformanceObserver((list) => data.longTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((list) => data.paints.push(...list.getEntries().map((entry) => ({ name: entry.name, start: entry.startTime })))).observe({ type: 'paint', buffered: true });
    })();`,
  });
  await send('Tracing.start', {
    categories: 'devtools.timeline,blink.user_timing,loading,v8,disabled-by-default-devtools.timeline.frame',
    options: 'sampling-frequency=10000',
    transferMode: 'ReportEvents',
  });
  await send('Page.reload', { ignoreCache: true });
  await sleep(4500);

  const evaluation = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__WUWA_STARTUP_PERF__)',
    returnByValue: true,
  });
  const metrics = await send('Performance.getMetrics');
  await send('Tracing.end');
  await tracingComplete;

  const pageData = JSON.parse(evaluation.result.value);
  const metricMap = Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value]));
  const longTraceTasks = traceEvents
    .filter((event) => event.ph === 'X' && typeof event.dur === 'number')
    .filter((event) => ['RunTask', 'TaskQueueManager::ProcessTaskFromWorkQueue'].includes(event.name) && event.dur >= 50000)
    .map((event) => event.dur / 1000);
  const newLogLines = readNewLogLines();
  const commands = commandDurations(newLogLines);
  const firstContentfulPaint = pageData.paints.find((paint) => paint.name === 'first-contentful-paint')?.start ?? null;
  const emptyStateSnapshots = pageData.animationSnapshots.filter((snapshot) =>
    snapshot.targets.some((targetName) => targetName.includes('instrument-empty')),
  );

  const report = {
    assets: {
      initial: { name: initialAsset[0], bytes: initialAsset[1] },
      analytics: { name: analyticsAsset[0], bytes: analyticsAsset[1] },
    },
    startup: {
      firstContentfulPaint,
      scriptDurationMs: metricMap.ScriptDuration * 1000,
      layoutDurationMs: metricMap.LayoutDuration * 1000,
      longTasks: pageData.longTasks,
      longTraceTasks,
      emptyStateSnapshots,
      consoleErrors,
      commands,
    },
    limits,
  };

  if (initialAsset[1] > limits.initialJavaScriptBytes) failures.push(`Initial JS is ${initialAsset[1]} bytes.`);
  if (analyticsAsset[1] > limits.analyticsJavaScriptBytes) failures.push(`Analytics JS is ${analyticsAsset[1]} bytes.`);
  if (firstContentfulPaint === null || firstContentfulPaint > limits.firstContentfulPaintMs) failures.push(`FCP is ${firstContentfulPaint ?? 'missing'}ms.`);
  if (report.startup.scriptDurationMs > limits.scriptDurationMs) failures.push(`Script duration is ${report.startup.scriptDurationMs.toFixed(1)}ms.`);
  if (report.startup.layoutDurationMs > limits.layoutDurationMs) failures.push(`Layout duration is ${report.startup.layoutDurationMs.toFixed(1)}ms.`);
  if (pageData.longTasks.length > 0 || longTraceTasks.length > 0) failures.push('A startup task exceeded 50ms.');
  if (emptyStateSnapshots.length > 0) failures.push('The animated empty state appeared during startup.');
  if (consoleErrors.length > 0) failures.push(`Console errors: ${consoleErrors.join(' | ')}`);
  for (const [command, limit] of Object.entries(limits.commandDurationMs)) {
    const durations = commands[command] ?? [];
    if (durations.length === 0) failures.push(`No ${command} timing was recorded.`);
    if (durations.some((duration) => duration > limit)) failures.push(`${command} exceeded ${limit}ms: ${durations.join(', ')}.`);
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportPath, passed: failures.length === 0 }, null, 2));
} finally {
  socket?.close();
  child.kill();
  await sleep(500);
}

if (failures.length > 0) {
  console.error(`Startup performance regression:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
