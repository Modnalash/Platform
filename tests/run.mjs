// Local browser test of the portal pages against an in-memory database.
// Usage: node run.mjs <repo dir> <output dir>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/opt/npm-tools/node_modules/');
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
const stub = fs.readFileSync(path.join(here, 'supabase-stub.js'), 'utf8');

// ---------- test data ----------
function makeDb() {
  const cats = ['Starter Kit', 'Express Lash', 'Wielokrotnego', 'Bio', 'Ribbon', 'Accessories', 'Make-up', 'Christmas Collection'];
  const stock = [], pl = [], uk = [];
  for (let i = 1; i <= 34; i++) {
    const sku = 'SK' + String(i).padStart(4, '0');
    const category = cats[i % cats.length];
    const name = `${category} item ${i} <b>&"x"`;      // awkward characters on purpose
    const qty = i % 7 === 0 ? 4 : 20 + i * 13;
    stock.push({ id: i, sku, name, category, qty, cost_usd: 0.5 + i / 10, sell_pln: 19 + i });
    pl.push({ id: i, sku, name, category, qty: i % 7 === 0 ? 3 : i * 2, created_at: '2026-01-01T00:00:00Z' });
    if (i % 3) uk.push({ id: 100 + i, sku, name, category, qty: i % 7 === 0 ? 1 : i * 3, created_at: '2026-01-01T00:00:00Z' });
  }
  const orders = [];
  const now = new Date('2026-11-27T12:00:00');
  let id = 1;
  for (let g = 0; g < 260; g++) {
    const gid = `${String(g).padStart(8, '0')}-aaaa-4bbb-8ccc-${String(g).padStart(12, '0')}`;
    const when = new Date(now.getTime() - g * 9.5 * 3600 * 1000);   // ~103 days back
    const region = g % 4 === 0 ? 'UK' : 'PL';
    const lines = 2 + (g % 7);
    for (let k = 0; k < lines; k++) {
      const s = stock[(g + k) % stock.length];
      orders.push({ id: id++, user_email: null, region, product: s.name, qty: 1 + ((g + k) % 6), status: g < 4 ? 'Pending' : 'Fulfilled',
        created_at: new Date(when.getTime() + k * 1000).toISOString().replace('Z', ''), order_group_id: gid, category: s.category, sku: s.sku });
    }
  }
  const profiles = [
    { id: 'u-admin', role: 'admin', email: 'admin@example.test', status: 'active', name: 'Admin', created_at: '2025-06-01T00:00:00Z', last_login: '2026-11-27T09:00:00' },
    { id: 'u-pl', role: 'pl', email: 'pl@example.test', status: 'active', name: 'PL user', created_at: '2025-06-02T00:00:00Z', last_login: null },
    { id: 'u-uk', role: 'uk', email: 'uk@example.test', status: 'active', name: 'UK user', created_at: '2025-06-03T00:00:00Z', last_login: null },
    { id: 'u-super', role: 'superadmin', email: 'super@example.test', status: 'active', name: 'Owner', created_at: '2025-06-04T00:00:00Z', last_login: null },
    { id: 'u-off', role: 'uk', email: 'off@example.test', status: 'disabled', name: 'Disabled', created_at: '2025-06-05T00:00:00Z', last_login: null },
  ];
  const audit_log = [];
  for (let i = 1; i <= 34; i++) {
    audit_log.push({ id: i, user_id: 'u-admin', user_email: 'admin@example.test', action: i % 5 === 0 ? 'Fulfill Order Group' : 'Login',
      details: i % 5 === 0 ? { gid: orders[900 + i].order_group_id, items: [{ sku: 'SK0001', qty: 2, note: 'x'.repeat(60) }] } : {},
      timestamp: new Date(now.getTime() - i * 3600 * 1000).toISOString() });
  }
  return { stock, pl_stock: pl, uk_stock: uk, orders, profiles, audit_log, fx_rates: [] };
}

const USERS = {
  admin: { id: 'u-admin', email: 'admin@example.test' },
  pl: { id: 'u-pl', email: 'pl@example.test' },
  uk: { id: 'u-uk', email: 'uk@example.test' },
  super: { id: 'u-super', email: 'super@example.test' },
  none: { id: 'u-none', email: 'none@example.test' },
};

const PAGES = [
  ['index.html', null], ['wait-for-role.html', 'none'],
  ['dashboard-admin.html', 'admin'], ['manage-stock.html', 'admin'], ['order-history.html', 'admin'], ['report.html', 'admin'],
  ['dashboard-pluser.html', 'pl'], ['manage-pl-stock.html', 'pl'], ['order-history-pl.html', 'pl'],
  ['dashboard-ukuser.html', 'uk'], ['dashboard-uk-stock.html', 'uk'], ['order-history-uk.html', 'uk'], ['dashboard-monika.html', 'uk'],
  ['superadmin-dashboard.html', 'super'], ['audit-log.html', 'super'], ['user-management.html', 'super'],
];

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

async function open(file, role, viewport = { width: 1360, height: 900 }, { keepNav = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => { page.__dialogs = (page.__dialogs || []).concat(d.message()); d.accept(); });
  await page.addInitScript(({ db, user, users }) => {
    window.__DB = db;
    const m = document.cookie.match(/tuser=([^;]+)/);      // remembers sign-in / sign-out across page loads
    window.__USER = m ? (m[1] === 'none' ? null : users[m[1]] || null) : user;
  }, { db: makeDb(), user: role ? USERS[role] : null, users: Object.fromEntries(Object.values(USERS).map(u => [u.id, u])) });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'app.test') {
      const f = path.join(repo, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    if (url.href.includes('supabase-js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: stub });
    if (url.href.includes('chart.js')) return route.fulfill({ status: 200, contentType: 'text/javascript',
      body: 'window.__CHARTS=[];window.Chart=class{constructor(c,cfg){window.__CHARTS.push(cfg)}destroy(){}};' });
    if (url.hostname === 'open.er-api.com') return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ result: 'success', rates: { PLN: 4, GBP: 0.8, EUR: 0.9 } }) });
    if (url.pathname.endsWith('.css') || url.hostname.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill({ status: 204, body: '' });
  });
  if (!keepNav) {
    // stop the page from navigating away during a test (redirects are recorded instead)
    await page.addInitScript(() => { window.__NAV = []; });
  }
  await page.goto('http://app.test/' + file);
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

// ---------- 1. every page loads cleanly, desktop + phone ----------
for (const [file, role] of PAGES) {
  for (const [label, vp] of [['desktop', { width: 1360, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const { ctx, page, errors } = await open(file, role, vp);
    const landed = path.basename(new URL(page.url()).pathname);
    check(`${file} [${label}] stays on page`, landed === file, landed);
    check(`${file} [${label}] no script errors`, errors.length === 0, errors.join(' | ').slice(0, 300));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${file} [${label}] no sideways page scroll`, overflow <= 1, `overflow ${overflow}px`);
    await page.screenshot({ path: path.join(out, `${file.replace('.html', '')}-${label}.png`), fullPage: true });
    await ctx.close();
  }
}

// ---------- 2. behaviour ----------
{ // admin dashboard numbers
  const { ctx, page, errors } = await open('dashboard-admin.html', 'admin');
  const db = makeDb();
  const sum = t => t.reduce((a, r) => a + r.qty, 0);
  const units = sum(db.stock) + sum(db.pl_stock);          // UK stock is left out on purpose
  const by = t => Object.fromEntries(t.map(r => [r.sku, r.qty]));
  const pl = by(db.pl_stock), uk = by(db.uk_stock);
  const tot = r => r.qty + (pl[r.sku] || 0);
  const value = db.stock.reduce((a, r) => a + tot(r) * r.sell_pln, 0);
  const cost = db.stock.reduce((a, r) => a + tot(r) * r.cost_usd * 4, 0);
  const low = db.stock.filter(r => tot(r) < 50).length;
  const digits = s => s.replace(/[^\d]/g, '');
  const txt = async id => (await page.textContent('#' + id)).trim();
  check('dashboard: units in stock', digits(await txt('stockCount')) === String(units), await txt('stockCount'));
  check('dashboard: stock value', digits(await txt('stockValue')) === String(Math.round(value)), `${await txt('stockValue')} vs ${Math.round(value)}`);
  check('dashboard: expected profit', digits((await txt('stockProfit')).split('profit')[1] || '') === String(Math.round(value - cost)), await txt('stockProfit'));
  check('dashboard: low stock count', digits(await txt('lowCount')) === String(low), `${await txt('lowCount')} vs ${low}`);
  check('dashboard: pending orders = 4 groups', (await txt('orderCount')) === '4', await txt('orderCount'));
  check('dashboard: pending split', (await txt('orderSplit')).startsWith('PL 3 · UK 1'), await txt('orderSplit'));
  // weekly chart: sum of the tooltips must equal the orders in the 12-week window (needs paging past 1000 rows)
  const tips = await page.$$eval('#weeklyBars .bar', els => els.map(e => +e.title.split(' ').slice(-2)[0].replace(/,/g, '')));
  const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const first = monday(new Date()); first.setDate(first.getDate() - 77);
  const inWin = db.orders.filter(o => new Date(o.created_at) >= first);
  const expected = inWin.reduce((a, o) => a + o.qty, 0);
  check('dashboard: weekly chart total', tips.reduce((a, b) => a + b, 0) === expected, `${tips.reduce((a, b) => a + b, 0)} vs ${expected} (${inWin.length} rows)`);
  check('dashboard: 12 weeks drawn', (await page.$$('#weeklyBars .week')).length === 12);
  check('dashboard: category bars incl. Christmas Collection', (await page.textContent('#categoryBars')).includes('Christmas Collection'));
  check('dashboard: latest orders rows', (await page.$$('#latestTable tbody tr')).length === 6);
  check('dashboard: product names are escaped', (await page.$$('#lowTable tbody b')).length === 0);
  check('dashboard: UK stock is not shown or counted', !(await txt('stockSplit')).includes('UK') && (await page.$$('#lowTable thead th')).length === 4 && (await page.$$('#lowTable tbody tr:first-child td')).length === 4);
  // the dashboard and the Report page must agree on stock value
  const rep = await open('report.html', 'admin');
  const repValue = digits((await rep.page.textContent('#sumPln')).split(',')[0]);
  check('dashboard: stock value equals the Report page', repValue === String(Math.round(value)), `report ${repValue} vs dashboard ${Math.round(value)}`);
  await rep.ctx.close();
  const writes = await page.evaluate(() => window.__WRITES);
  check('dashboard: only write is the Login audit entry', writes.length === 1 && writes[0].table === 'audit_log', JSON.stringify(writes).slice(0, 200));
  check('dashboard: no errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}
{ // manage stock
  const { ctx, page, errors } = await open('manage-stock.html', 'admin');
  const opts = await page.$$eval('#productCategory option', o => o.map(x => x.value));
  check('manage-stock: Christmas Collection in category list', opts.includes('Christmas Collection'));
  check('manage-stock: rows rendered', (await page.$$('#stockTable tbody tr')).length === 34);
  await page.fill('#add-1', '5');
  await page.locator('#stockTable tbody tr', { has: page.locator('#add-1') }).locator('.btn-add').click();
  await page.waitForTimeout(200);
  let w = await page.evaluate(() => window.__WRITES);
  check('manage-stock: Add qty updates stock', w.some(x => x.op === 'update' && x.table === 'stock' && x.values.qty === 33 + 5), JSON.stringify(w).slice(0, 200));
  await page.click('#stockTable tbody tr:first-child .btn-edit');
  check('manage-stock: edit modal opens', await page.isVisible('#editModal .modal-content'));
  await page.fill('#editName', 'Renamed');
  await page.click('.modal-actions button:last-child');
  await page.waitForTimeout(200);
  w = await page.evaluate(() => window.__WRITES);
  check('manage-stock: Save edit', w.some(x => x.op === 'update' && x.table === 'stock' && x.values.name === 'Renamed'));
  check('manage-stock: modal closes', !(await page.isVisible('#editModal .modal-content')));
  await page.fill('#productName', 'Xmas box');
  await page.selectOption('#productCategory', 'Christmas Collection');
  await page.fill('#productQty', '10'); await page.fill('#costUsd', '1.5'); await page.fill('#sellPln', '49');
  await page.click('.controls .btn-add');
  await page.waitForTimeout(300);
  w = await page.evaluate(() => window.__WRITES);
  const ins = w.find(x => x.op === 'insert' && x.table === 'stock');
  check('manage-stock: Add product (Christmas Collection, next SKU)', !!ins && ins.rows[0].category === 'Christmas Collection' && ins.rows[0].sku === 'SK0035', JSON.stringify(ins || {}).slice(0, 200));
  check('manage-stock: also adds PL stock row', w.some(x => x.op === 'insert' && x.table === 'pl_stock'));
  await page.click('#stockTable tbody tr:first-child .btn-delete');
  await page.waitForTimeout(200);
  w = await page.evaluate(() => window.__WRITES);
  check('manage-stock: Delete', w.some(x => x.op === 'delete' && x.table === 'stock' && x.matched === 1));
  await page.click('.sidebar a[href="index.html"]');
  await page.waitForTimeout(300);
  check('manage-stock: Log out lands on login', page.url().endsWith('/index.html'), page.url());
  check('manage-stock: no errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}
for (const [file, role, region, vp] of [['dashboard-pluser.html', 'pl', 'PL', { width: 1360, height: 900 }], ['dashboard-ukuser.html', 'uk', 'UK', { width: 1360, height: 900 }],
  ['dashboard-pluser.html', 'pl', 'PL', { width: 390, height: 800 }]]) {
  const { ctx, page, errors } = await open(file, role, vp);
  if (vp.width < 600) {
    const box = await page.locator('#stockTable tbody tr').nth(1).locator('.order-btn').boundingBox();
    check(`${file} [phone]: Add button fits on screen`, box && box.x + box.width <= 390, JSON.stringify(box));
  }
  check(`${file}: stock rows`, (await page.$$('#stockTable tbody tr')).length === 34);
  await page.fill('#searchInput', 'SK0002');
  check(`${file}: search filters rows`, (await page.$$eval('#stockTable tbody tr', r => r.filter(x => x.style.display !== 'none').length)) === 1);
  await page.fill('#searchInput', '');
  await page.selectOption('#categoryFilter', 'Christmas Collection');
  const vis = await page.$$eval('#stockTable tbody tr', r => r.filter(x => x.style.display !== 'none').length);
  check(`${file}: category filter`, vis === 4, String(vis));
  await page.selectOption('#categoryFilter', 'All');
  const input = page.locator('#stockTable tbody tr').nth(1).locator('input');
  await input.fill('2');
  await page.locator('#stockTable tbody tr').nth(1).locator('.order-btn').click();
  check(`${file}: order summary lists the item`, (await page.$$('#orderPreview li')).length === 1);
  await page.click('.submit-btn');
  await page.waitForTimeout(400);
  const w = await page.evaluate(() => window.__WRITES);
  const ins = w.find(x => x.op === 'insert' && x.table === 'orders');
  check(`${file}: order inserted`, !!ins && ins.rows[0].region === region && ins.rows[0].qty === 2 && ins.rows[0].status === 'Pending', JSON.stringify(ins || {}).slice(0, 200));
  check(`${file}: stock reduced`, w.some(x => x.op === 'update' && x.table === 'stock' && x.matched === 1));
  check(`${file}: success message`, (page.__dialogs || []).some(d => d.includes('Order placed successfully')));
  check(`${file}: no errors`, errors.length === 0, errors.join('|'));
  await ctx.close();
}
{ // admin order history
  const { ctx, page, errors } = await open('order-history.html', 'admin');
  const blocks = await page.$$('.order-block');
  check('order-history: order blocks', blocks.length > 50, String(blocks.length));
  check('order-history: status pills', (await page.$$('.order-block .pill-pending')).length > 0 && (await page.$$('.order-block .pill-fulfilled')).length > 0);
  const view = page.locator('.btn-view').first();
  await view.click();
  check('order-history: View Full Order toggles', (await view.textContent()) === 'Hide Full Order');
  await page.locator('.btn-fulfill:not([disabled])').first().click();
  await page.waitForTimeout(500);
  const w = await page.evaluate(() => window.__WRITES);
  check('order-history: Fulfill marks orders', w.some(x => x.op === 'update' && x.table === 'orders' && x.values.status === 'Fulfilled' && x.matched > 0));
  check('order-history: Fulfill moves stock to region table', w.some(x => x.op === 'update' && (x.table === 'pl_stock' || x.table === 'uk_stock')));
  check('order-history: Fulfill writes audit entry', w.some(x => x.op === 'insert' && x.table === 'audit_log' && x.rows[0].action === 'Fulfill Order Group'));
  check('order-history: no errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}
for (const [file, role, table] of [['manage-pl-stock.html', 'pl', 'pl_stock'], ['dashboard-monika.html', 'uk', 'uk_stock']]) {
  const { ctx, page, errors } = await open(file, role);
  check(`${file}: rows`, (await page.$$('#localStockTable tbody tr')).length === 34);
  await page.fill('#adj-1', '77');
  await page.locator('#localStockTable tbody tr', { has: page.locator('#adj-1') }).locator('td.actions button').click();
  await page.waitForTimeout(300);
  const w = await page.evaluate(() => window.__WRITES);
  check(`${file}: Update writes ${table}`, w.some(x => x.table === table && (x.op === 'update' ? x.values.qty === 77 : x.rows[0].qty === 77)), JSON.stringify(w).slice(0, 300));
  check(`${file}: no errors`, errors.length === 0, errors.join('|'));
  await ctx.close();
}
{ // report
  const { ctx, page, errors } = await open('report.html', 'admin');
  check('report: 10 rows per page', (await page.$$('#reportTable tbody tr')).length === 10);
  check('report: summary filled', (await page.textContent('#sumPln')).trim() !== '0.00 PLN');
  await page.click('#nextBtn');
  check('report: pagination', (await page.textContent('#pageInfo')).startsWith('Page 2'));
  check('report: chart drawn', (await page.evaluate(() => window.__CHARTS.length)) >= 1);
  await page.selectOption('#viewMode', 'margin');
  check('report: margin view', (await page.textContent('#colX1')) === 'Margin %');
  check('report: no errors', errors.length === 0, errors.join('|'));
  await ctx.close();
}
{ // audit log + users
  let { ctx, page, errors } = await open('audit-log.html', 'super');
  check('audit-log: 10 rows', (await page.$$('#audit-log-tbody tr')).length === 10);
  const btn = page.locator('.expand-link').first();
  await btn.click();
  const fullId = (await btn.getAttribute('id')).replace('expand-', 'full-');
  check('audit-log: Show details expands', await page.isVisible('#' + fullId));
  await page.click('#next-page-btn');
  check('audit-log: next page', (await page.textContent('#page-num-label')).startsWith('Page 2'));
  check('audit-log: no errors', errors.length === 0, errors.join('|'));
  await ctx.close();
  ({ ctx, page, errors } = await open('user-management.html', 'super'));
  check('users: 5 rows', (await page.$$('#usersTableBody tr')).length === 5);
  await page.locator('#usersTableBody button').first().click();
  await page.waitForTimeout(200);
  const w = await page.evaluate(() => window.__WRITES);
  check('users: Disable updates profile', w.some(x => x.op === 'update' && x.table === 'profiles'));
  check('users: no errors', errors.length === 0, errors.join('|'));
  await ctx.close();
  ({ ctx, page, errors } = await open('superadmin-dashboard.html', 'super'));
  check('superadmin: cards visible', await page.isVisible('#dashboard-cards'));
  check('superadmin: users stat', (await page.textContent('#stat-users')).trim() === '5');
  await ctx.close();
}
{ // login
  const { ctx, page, errors } = await open('index.html', null);
  await page.fill('#email', 'admin@example.test');
  await page.fill('#password', 'test-only');
  await page.click('#loginBtn');
  await page.waitForTimeout(600);
  check('login: admin is sent to the admin dashboard', page.url().endsWith('/dashboard-admin.html'), page.url());
  await ctx.close();
}
{ // role guard still redirects
  const { ctx, page } = await open('dashboard-admin.html', 'pl');
  check('guard: PL user is sent away from the admin dashboard to their own', page.url().endsWith('/dashboard-pluser.html'), page.url());
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(out, 'results.txt'), results.join('\n') + '\n');
console.log(results.filter(r => r.startsWith('FAIL')).join('\n') || 'no failures');
console.log(`\n${results.length - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
