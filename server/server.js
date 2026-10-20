import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import path from 'path';
import config from './config.js';
import { tokenize } from './matcher.js';

let browser = null;
let context = null;
let cache = { rows: [], headers: [], mapping: {}, fetchedAt: 0 };
let syncing = null;

// ---------- browser / login ----------

const isLocal = !process.env.AWS_EXECUTION_ENV && process.env.NODE_ENV !== 'production';

async function getContext() {
  if (!browser) {
    if (isLocal) {
      browser = await playwright.launch({ headless: config.headless });
    } else {
      chromium.setGraphicsMode = false;
      const executablePath = await chromium.executablePath();
      process.env.LD_LIBRARY_PATH = path.dirname(executablePath);

      browser = await playwright.launch({
        args: chromium.args,
        executablePath,
        headless: true,
      });
    }
  }
  if (!context) context = await browser.newContext();
  return context;
}

async function debugDump(page, name) {
  try {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const text = await page
      .evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300))
      .catch(() => '');
    console.log(`[debug] url: ${url}`);
    console.log(`[debug] title: ${title}`);
    console.log(`[debug] page text: ${text}`);
    await page.screenshot({ path: `debug-${name}.png`, fullPage: true });
    console.log(`[debug] screenshot saved: server/debug-${name}.png`);
  } catch (e) {
    console.log('[debug] could not save debug info:', e.message);
  }
}

async function login(page) {
  if (!config.username || !config.password) {
    throw new Error('Missing GLERCIMOR_USER / GLERCIMOR_PASS in server/.env');
  }
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  const pwd = page.locator(config.selectors.password).first();
  if (!(await pwd.count())) return;

  await page.locator(config.selectors.username).first().fill(config.username);
  await pwd.fill(config.password);
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.locator(config.selectors.submit).first().click(),
  ]);

  if (await page.locator(config.selectors.password).count()) {
    await debugDump(page, 'login');
    throw new Error('Login failed: the password field is still showing. Check your credentials.');
  }
}

async function gotoWithRetry(page, url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
      return;
    } catch (e) {
      console.log(`Opening ${url} failed (attempt ${i}/${tries}): ${e.message.split('\n')[0]}`);
      if (i === tries) throw e;
    }
  }
}

async function openCustomerList(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await gotoWithRetry(page, config.dataUrl);
    console.log('Customer page requested, waiting for the table or a login form...');
    const row = page.locator(`${config.selectors.table} tbody tr`).first();
    const pwd = page.locator(config.selectors.password).first();
    try {
      await row.or(pwd).waitFor({ state: 'visible', timeout: 90000 });
    } catch {
      await debugDump(page, 'no-table');
      throw new Error(
        `The customer page showed neither a table nor a login form after 90 seconds. ` +
          `Page address: ${page.url()}. A screenshot was saved as server/debug-no-table.png`
      );
    }
    if (await pwd.isVisible().catch(() => false)) {
      console.log('The portal asked for a login again, logging in...');
      await login(page);
      continue;
    }
    console.log('Table rows are visible.');
    return;
  }
  await debugDump(page, 'login-loop');
  throw new Error('The portal kept asking for a login. Check your credentials and close other portal sessions.');
}

// ---------- table reading ----------

async function readTable(page) {
  return page.evaluate((tableSel) => {
    const table = document.querySelector(tableSel);
    if (!table) return { headers: [], rows: [] };
    const clean = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    let headers = [...table.querySelectorAll('thead th')].map(clean);
    let trs = [...table.querySelectorAll('tbody tr')];
    if (!headers.length) {
      const first = table.querySelector('tr');
      headers = first ? [...first.children].map(clean) : [];
      trs = trs.slice(1);
    }
    const rows = trs
      .map((tr) => [...tr.children].map(clean))
      .filter((cells) => cells.length > 1);
    return { headers, rows };
  }, config.selectors.table);
}

const rowCount = (page) =>
  page.evaluate(
    (sel) => document.querySelectorAll(`${sel} tbody tr`).length,
    config.selectors.table
  );

async function readInfo(page) {
  const text = await page.evaluate(() => document.body.innerText || '');
  const m = text.match(/Showing\s+([\d,]+)\s+to\s+([\d,]+)\s+of\s+([\d,]+)\s+entries/i);
  if (!m) return null;
  const n = (s) => Number(s.replace(/,/g, ''));
  return { from: n(m[1]), to: n(m[2]), total: n(m[3]) };
}

async function waitForPage(page, { from, minTo } = {}, maxMs = 120000) {
  const start = Date.now();
  let okSince = 0;
  while (Date.now() - start < maxMs) {
    const info = await readInfo(page);
    if (info) {
      const n = await rowCount(page);
      const fromOk = from === undefined || info.from === from;
      const sizeOk = minTo === undefined || info.to >= minTo;
      if (fromOk && sizeOk && n === info.to - info.from + 1) {
        if (!okSince) okSince = Date.now();
        if (Date.now() - okSince >= 700) return info;
      } else {
        okSince = 0;
      }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function showMaxRows(page, total) {
  const select = page.locator(config.selectors.pageLength).first();
  if (!(await select.count())) return;
  const values = await select.locator('option').evaluateAll((opts) =>
    opts.map((o) => o.value)
  );
  const target = values.includes('-1')
    ? '-1'
    : values.map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => b - a)[0];
  if (target === undefined) return;
  const expected = String(target) === '-1' ? total : Math.min(Number(target), total);
  await select.selectOption(String(target));
  const info = await waitForPage(page, { from: 1, minTo: expected });
  if (!info) console.log('Page size change did not finish in time; continuing with the current size.');
}

function mapColumns(headers) {
  const mapping = {};
  const taken = new Set();
  for (const [field, regex] of Object.entries(config.columns)) {
    const idx = headers.findIndex((h, i) => !taken.has(i) && regex.test(h));
    if (idx >= 0) {
      mapping[field] = idx;
      taken.add(idx);
    }
  }
  return mapping;
}

export function billToPlan(billText) {
  const amount = parseFloat(String(billText || '').replace(/[^0-9.]/g, ''));
  if (!amount) return '';
  const mbps = config.billToMbps[Math.round(amount)];
  return mbps ? `${mbps} MBPS` : `UNKNOWN (BILL ${amount})`;
}

async function setStatusAll(page, prevTotal) {
  let acted = false;

  const selects = page.locator('select:not([name$="_length"]):not([id$="_length"])');
  const count = await selects.count();
  for (let i = 0; i < count; i++) {
    const sel = selects.nth(i);
    const options = await sel.locator('option').evaluateAll((opts) =>
      opts.map((o) => o.textContent.trim())
    );

    const isStatus = options.some((t) => /active|inactive|disconnect|suspend/i.test(t));
    if (!isStatus || acted) continue;

    const allLabel = options.find((t) => /^(all|all status(es)?|any)\b/i.test(t));
    if (allLabel) {
      await sel.selectOption({ label: allLabel }, { force: true });
      acted = true;
    }
  }

  if (!acted) {
    for (const role of ['tab', 'button']) {
      const el = page.getByRole(role, { name: /^all$/i }).first();
      if (await el.count()) {
        await el.click();
        acted = true;
        break;
      }
    }
  }

  if (!acted) return;

  const apply = page.getByRole('button', { name: /^(search|filter|apply|submit)$/i }).first();
  if (await apply.count()) {
    await apply.click();
  }

  const start = Date.now();
  while (Date.now() - start < 20000) {
    const info = await readInfo(page);
    if (info && info.total !== prevTotal) return;
    await page.waitForTimeout(500);
  }
}

// ---------- sync ----------

async function scrapeAll() {
  console.log('=== Starting a full scrape of the portal ===');
  const ctx = await getContext();
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);
  try {
    await login(page);
    await openCustomerList(page);

    const first = await waitForPage(page, { from: 1 });
    if (!first) {
      await debugDump(page, 'no-info');
      throw new Error('Could not find entry details text on the page.');
    }
    await setStatusAll(page, first.total);
    const afterFilter = await waitForPage(page, { from: 1 });
    const total = (afterFilter || first).total;
    await showMaxRows(page, total);

    let headers = [];
    const seen = new Set();
    const all = [];

    for (let i = 0; i < config.maxPages; i++) {
      const info = await readInfo(page);
      const t = await readTable(page);
      if (!headers.length) headers = t.headers;
      for (const r of t.rows) {
        const key = r.join('|');
        if (!seen.has(key)) {
          seen.add(key);
          all.push(r);
        }
      }

      if (!info || info.to >= info.total) break;

      const next = page.locator(config.selectors.nextButton).first();
      if (!(await next.count())) break;
      await next.click();
      const moved = await waitForPage(page, { from: info.to + 1 });
      if (!moved) throw new Error('Pagination did not load next rows in time.');
    }

    if (all.length < total * 0.99) {
      throw new Error(`Only collected ${all.length} of ${total} accounts.`);
    }

    const mapping = mapColumns(headers);
    const missing = Object.keys(config.columns).filter((f) => !(f in mapping));
    if (missing.length) {
      throw new Error(`Could not find column(s): ${missing.join(', ')}.`);
    }

    const rows = all.map((cells) => {
      const get = (f) => cells[mapping[f]] || '';
      const accountName = get('accountName');
      return {
        accountName,
        accountNo: get('accountNo'),
        contact: get('contact'),
        bill: get('bill'),
        plan: billToPlan(get('bill')),
        address: get('address'),
        _tokens: tokenize(accountName),
      };
    });

    cache = { rows, headers, mapping, fetchedAt: Date.now() };
    return cache;
  } finally {
    await page.close().catch(() => {});
  }
}

export function sync(force = false) {
  const fresh = Date.now() - cache.fetchedAt < config.cacheMinutes * 60000;
  if (!force && cache.rows.length && fresh) {
    return Promise.resolve(cache);
  }
  if (!syncing) syncing = scrapeAll().finally(() => (syncing = null));
  return syncing;
}

export function status() {
  return {
    loaded: cache.rows.length,
    fetchedAt: cache.fetchedAt || null,
    syncing: Boolean(syncing),
  };
}

export function inspect() {
  return {
    headers: cache.headers,
    mapping: cache.mapping,
    sample: cache.rows.slice(0, 3).map(({ _tokens, ...r }) => r),
  };
}

export async function shutdown() {
  await browser?.close().catch(() => {});
}