import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const rustSource = readFileSync(
  new URL('../src-tauri/src/commands/cloud_gacha.rs', import.meta.url),
  'utf8',
);
const scriptMatch = rustSource.match(
  /const CLOUD_CAPTURE_SCRIPT: &str = r#"\r?\n([\s\S]*?)\r?\n"#;/,
);

assert.ok(scriptMatch, 'could not extract CLOUD_CAPTURE_SCRIPT from Rust source');
const cloudCaptureScript = scriptMatch[1];

function createHarness({ bodyText = '', controls = [], wrappers = [], targetFrame = null } = {}) {
  let now = 0;
  let nextTimerId = 1;
  let mutationCallback = null;
  const timers = [];
  const elementsById = new Map();

  class FakeElement {
    constructor({ text = '', attributes = {}, width = 100, height = 40 } = {}) {
      this.textContent = text;
      this.innerText = text;
      this.attributes = new Map(Object.entries(attributes));
      this.children = [];
      this.style = {};
      this.width = width;
      this.height = height;
      this.clickCount = 0;
      this.queries = new Map();
      this.closestMatches = new Map();
    }

    appendChild(child) {
      this.children.push(child);
      if (child.id) elementsById.set(child.id, child);
      return child;
    }

    click() {
      this.clickCount += 1;
    }

    closest(selector) {
      return this.closestMatches.get(selector) || null;
    }

    getAttribute(name) {
      return this.attributes.get(name) || null;
    }

    getBoundingClientRect() {
      return { width: this.width, height: this.height };
    }

    querySelector(selector) {
      return this.queries.get(selector) || null;
    }
  }

  const body = new FakeElement({ text: bodyText });
  const documentElement = new FakeElement();
  const document = {
    body,
    documentElement,
    readyState: 'complete',
    addEventListener() {},
    createElement: () => new FakeElement(),
    getElementById: (id) => elementsById.get(id) || null,
    querySelector(selector) {
      return selector.startsWith('iframe[') ? targetFrame : null;
    },
    querySelectorAll(selector) {
      if (selector === '.tools-inner .tool-card-wrapper') return wrappers;
      if (selector === 'button, a, [role="button"]') return controls;
      if (selector === '[aria-label]') return [];
      if (selector === 'span, div, p') return [];
      return [];
    },
  };

  function schedule(callback, delay, interval = 0) {
    const timer = { id: nextTimerId++, at: now + delay, callback, interval };
    timers.push(timer);
    return timer.id;
  }

  const location = {
    origin: 'https://mc.kurogames.com',
    href: 'https://mc.kurogames.com/cloud/index.html#/',
  };
  const window = {
    location,
    clearTimeout(id) {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    setInterval: (callback, delay) => schedule(callback, delay, delay),
    setTimeout: (callback, delay) => schedule(callback, delay),
  };
  window.top = window;

  class FakeMutationObserver {
    constructor(callback) {
      mutationCallback = callback;
    }

    observe() {}
  }

  class FakeDate extends Date {
    static now() {
      return now;
    }
  }

  vm.runInNewContext(cloudCaptureScript, {
    Array,
    Date: FakeDate,
    Element: FakeElement,
    MutationObserver: FakeMutationObserver,
    document,
    encodeURIComponent,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    window,
  });

  function advance(milliseconds) {
    const end = now + milliseconds;
    let executions = 0;
    while (true) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const timer = timers[0];
      if (!timer || timer.at > end) break;
      timers.shift();
      now = timer.at;
      if (timer.interval) {
        timers.push({ ...timer, at: now + timer.interval });
      }
      timer.callback();
      executions += 1;
      assert.ok(executions < 10000, 'virtual timer loop did not settle');
    }
    now = end;
  }

  return {
    FakeElement,
    advance,
    body,
    document,
    location,
    notifyMutation: () => mutationCallback?.(),
    setTargetFrame(frame) {
      targetFrame = frame;
    },
    status: () => elementsById.get('wuwa-gacha-helper')?.textContent || '',
  };
}

function createToolControl(FakeElement) {
  return new FakeElement({ text: '工具' });
}

function createCardWrapper(FakeElement, text = '') {
  const wrapper = new FakeElement({ text });
  const card = new FakeElement();
  wrapper.queries.set('.tool-card', card);
  return { wrapper, card };
}

function createGachaFrame(FakeElement) {
  const src = 'https://aki-gm-resources.aki-game.com/aki/gacha/index.html?svr_id=server&player_id=10001&record_id=token&resources_id=pool#/record';
  const frame = new FakeElement({ attributes: { src } });
  frame.src = src;
  return frame;
}

test('waits for a delayed login before clicking Tools', () => {
  const harness = createHarness();
  const tool = createToolControl(harness.FakeElement);
  harness.document.querySelectorAll = (selector) => (
    selector === 'button, a, [role="button"]' ? [tool] : []
  );

  harness.advance(250);
  assert.equal(tool.clickCount, 0);
  assert.match(harness.status(), /请先登录云鸣潮/);

  harness.body.innerText = '通行证 ID：523580125';
  harness.notifyMutation();
  harness.advance(250);
  assert.equal(tool.clickCount, 1);
});

test('selects the semantic gacha card even when it is not first', () => {
  const harness = createHarness({ bodyText: '通行证ID: 523580125' });
  const tool = createToolControl(harness.FakeElement);
  const guide = createCardWrapper(harness.FakeElement, '攻略站');
  const gacha = createCardWrapper(harness.FakeElement, '唤 取 记 录');
  harness.document.querySelectorAll = (selector) => {
    if (selector === '.tools-inner .tool-card-wrapper') return [guide.wrapper, gacha.wrapper];
    if (selector === 'button, a, [role="button"]') return [tool];
    return [];
  };

  harness.advance(500);
  assert.equal(tool.clickCount, 1);
  assert.equal(guide.card.clickCount, 0);
  assert.equal(gacha.card.clickCount, 1);
});

test('recognizes a Lottie card by its aria label when visible text is unavailable', () => {
  const harness = createHarness({ bodyText: '通行证ID: 523580125' });
  const tool = createToolControl(harness.FakeElement);
  const guide = createCardWrapper(harness.FakeElement);
  const gacha = createCardWrapper(harness.FakeElement);
  gacha.wrapper.queries.set(
    '[aria-label="唤取记录"]',
    new harness.FakeElement({ attributes: { 'aria-label': '唤取记录' } }),
  );
  harness.document.querySelectorAll = (selector) => {
    if (selector === '.tools-inner .tool-card-wrapper') return [guide.wrapper, gacha.wrapper];
    if (selector === 'button, a, [role="button"]') return [tool];
    return [];
  };

  harness.advance(500);
  assert.equal(guide.card.clickCount, 0);
  assert.equal(gacha.card.clickCount, 1);
});

test('does not guess by position after the official card structure changes', () => {
  const harness = createHarness({ bodyText: '通行证ID: 523580125' });
  const tool = createToolControl(harness.FakeElement);
  const cards = ['A', 'B', 'C'].map((text) => createCardWrapper(harness.FakeElement, text));
  harness.document.querySelectorAll = (selector) => {
    if (selector === '.tools-inner .tool-card-wrapper') return cards.map(({ wrapper }) => wrapper);
    if (selector === 'button, a, [role="button"]') return [tool];
    return [];
  };

  harness.advance(11000);
  assert.ok(cards.every(({ card }) => card.clickCount === 0));
  assert.match(harness.status(), /请手动打开/);
});

test('keeps capture active after record retries fall back to manual operation', () => {
  const harness = createHarness({ bodyText: '通行证ID: 523580125' });
  const tool = createToolControl(harness.FakeElement);
  const gacha = createCardWrapper(harness.FakeElement, '唤取记录');
  harness.document.querySelectorAll = (selector) => {
    if (selector === '.tools-inner .tool-card-wrapper') return [gacha.wrapper];
    if (selector === 'button, a, [role="button"]') return [tool];
    return [];
  };

  harness.advance(25000);
  assert.equal(gacha.card.clickCount, 3);
  assert.match(harness.status(), /页面未能自动加载.*请手动打开/);

  harness.setTargetFrame(createGachaFrame(harness.FakeElement));
  harness.notifyMutation();
  harness.advance(300);
  assert.match(harness.location.href, /^wuwa-gacha:\/\/captured\?url=/);
});

test('manual capture still works when login detection itself times out', () => {
  const harness = createHarness();
  const tool = createToolControl(harness.FakeElement);
  harness.document.querySelectorAll = (selector) => (
    selector === 'button, a, [role="button"]' ? [tool] : []
  );

  harness.advance(20500);
  assert.equal(tool.clickCount, 0);
  assert.match(harness.status(), /未能自动确认登录状态.*请手动打开/);

  harness.setTargetFrame(createGachaFrame(harness.FakeElement));
  harness.notifyMutation();
  harness.advance(300);
  assert.match(harness.location.href, /^wuwa-gacha:\/\/captured\?url=/);
});

test('captures an official iframe without relying on its CSS class', () => {
  const harness = createHarness();
  harness.setTargetFrame(createGachaFrame(harness.FakeElement));
  harness.advance(250);

  assert.match(harness.location.href, /^wuwa-gacha:\/\/captured\?url=/);
});
