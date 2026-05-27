/**
 * Baseline: Value List Update — waitUntilDocumentIndexed (current default behaviour)
 *
 * Measures PUT /api/lists/items — the current update path.
 *
 * Root cause: updateListItem (services/items/update_list_item.ts) calls
 * waitUntilDocumentIndexed after every updateByQuery. That function hardcodes a
 * 1,000 ms sleep before polling getListItem for a version change:
 *
 *   const DEFAULT_INDEX_REFRESH_TIME = 1000;
 *   await new Promise((resolve) => setTimeout(resolve, 1000)); // always sleeps 1s
 *   await pRetry(fn, { minTimeout: 1000, retries: 5 });
 *
 * Expected: ~1,000 ms/item (same wall-clock floor as the create wait_for baseline,
 * different mechanism).
 *
 * Setup: loads pre-created items from bench-update-items.json if it exists (run
 * bench-update-value-list-items-setup.ts once to generate it). Falls back to inline
 * POST refresh:wait_for setup (~1s/item) when the file is absent.
 *
 * No code change required — runs against any Kibana version.
 *
 * Usage:
 *   # Fast: pre-create items first
 *   npx tsx bench-update-value-list-items-setup.ts
 *   npx tsx bench-update-value-list-items-baseline.ts
 *
 *   # Standalone (inline setup, slow):
 *   npx tsx bench-update-value-list-items-baseline.ts
 *
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 25 50 100" \
 *     npx tsx bench-update-value-list-items-baseline.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { KB_URL, parseNValues, kbPost, kbPut, kbDelete, printTable, fmtMs, perItem, extrapolate } from './bench-utils';

const LIST_ID = 'bench-vl-upd-baseline-266239';
const SETUP_FILE = join(__dirname, 'bench-update-items.json');

interface Item { id: string; value: string }
interface SetupFile { listId: string; items: Item[] }

async function initDataStreams(): Promise<void> {
  const res = await kbPost('/api/lists/index', {});
  if (!res.ok) {
    const text = await res.text().catch(() => `(no body)`);
    throw new Error(`Init data streams: HTTP ${res.status} — ${text}`);
  }
}

async function inlineSetup(n: number): Promise<{ setupMs: number; items: Item[] }> {
  await kbDelete(`/api/lists?id=${LIST_ID}`);
  const listRes = await kbPost('/api/lists', {
    id: LIST_ID,
    name: 'Bench value list (update baseline)',
    description: '#266239 benchmark',
    type: 'keyword',
  });
  if (!listRes.ok) {
    const body = (await listRes.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Create list: HTTP ${listRes.status} — ${body.message ?? JSON.stringify(body)}`);
  }
  await listRes.json();

  const t0 = Date.now();
  const items: Item[] = [];
  for (let i = 0; i < n; i++) {
    const value = `upd-v0-${i}`;
    const res = await kbPost('/api/lists/items', { list_id: LIST_ID, value });
    if (!res.ok) throw new Error(`Setup item ${i}: HTTP ${res.status}`);
    items.push({ id: ((await res.json()) as { id: string }).id, value });
  }
  return { setupMs: Date.now() - t0, items };
}

async function run(items: Item[], runTag: string): Promise<number> {
  const t0 = Date.now();
  for (let i = 0; i < items.length; i++) {
    const res = await kbPut('/api/lists/items', { id: items[i].id, value: `upd-${runTag}-${i}` });
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`PUT item ${items[i].id}: HTTP ${res.status} — ${body}`);
    }
    await res.json();
  }
  return Date.now() - t0;
}

async function main(): Promise<void> {
  const nValues = parseNValues('10 25 50 100');
  const hasSetupFile = existsSync(SETUP_FILE);

  console.log('=== Value List Update — waitUntilDocumentIndexed baseline ===');
  console.log(`  Target   : ${KB_URL}`);
  console.log(`  N sweep  : ${nValues.join(' ')}`);
  console.log(`  Setup    : ${hasSetupFile ? `pre-created items from ${SETUP_FILE}` : 'inline POST refresh:wait_for (~1s/item)'}`);
  console.log('  Bottleneck: waitUntilDocumentIndexed — hardcoded 1s sleep in update_list_item.ts');
  console.log('  Expected : ~1,000 ms/item');
  console.log('');

  process.stderr.write('  Init data streams … ');
  await initDataStreams();
  process.stderr.write('done\n\n');

  const preCreated = hasSetupFile
    ? (JSON.parse(readFileSync(SETUP_FILE, 'utf8')) as SetupFile).items
    : null;

  type Row = [number, string, number, string];
  const rows: Row[] = [];
  let lastMs = 0;
  let lastN = 0;

  for (const n of nValues) {
    let items: Item[];
    let setupMs: number;

    if (preCreated) {
      if (preCreated.length < n) {
        console.warn(`  WARN: setup file has ${preCreated.length} items but N=${n} requested — re-run bench-update-value-list-items-setup.ts with N_ITEMS=${n}`);
        continue;
      }
      items = preCreated.slice(0, n);
      setupMs = 0;
    } else {
      process.stderr.write(`  N=${n}: setup (${n} creates ~${n}s) … `);
      ({ setupMs, items } = await inlineSetup(n));
    }

    process.stderr.write(`  N=${n}: PUT ${n} items … `);
    const ms = await run(items, `${n}-${Date.now()}`);
    process.stderr.write(`done\n`);
    rows.push([n, setupMs === 0 ? 'pre-created' : fmtMs(setupMs), ms, perItem(ms, n)]);
    lastMs = ms;
    lastN = n;
  }

  console.log('');
  printTable(
    [
      { header: 'N', width: 6 },
      { header: 'setup', width: 14 },
      { header: 'update total ms', width: 17 },
      { header: 'ms/PUT', width: 10 },
    ],
    rows
  );

  if (lastN > 0) {
    console.log('');
    console.log(`  Customer extrapolation: ${extrapolate(lastMs / lastN, 12_000)}`);
  }

  if (!preCreated) await kbDelete(`/api/lists?id=${LIST_ID}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
