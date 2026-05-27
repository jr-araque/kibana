/**
 * POC: Value List Update — no waitUntilDocumentIndexed sleep (requires server fix)
 *
 * Measures PUT /api/lists/items after the waitUntilDocumentIndexed fix is applied.
 *
 * What needs to change server-side (wait_until_document_indexed.ts):
 *   Remove the hardcoded 1,000 ms upfront sleep. With get_list_item.ts using
 *   esClient.get (translog read), the _version change is visible immediately after
 *   updateByQuery — no segment refresh wait is needed before polling.
 *
 *   Before fix:
 *     await new Promise((resolve) => setTimeout(resolve, 1000)); // always sleeps 1s
 *     await pRetry(fn, { minTimeout: 1000, retries: 5 });
 *
 *   After fix:
 *     await pRetry(fn, { minTimeout: 50, retries: 5 });
 *
 * This script runs the same PUT calls as bench-update-value-list-items-baseline.ts.
 * Before the fix it will show ~1,000 ms/item (same as baseline).
 * After the fix it should show ~20 ms/item.
 *
 * Requires: esClient.get POC applied in get_list_item.ts AND 1s sleep removed from
 *   wait_until_document_indexed.ts.
 *
 * Setup: POST refresh:wait_for (default) — ensures items are indexed before PUT loop.
 * Once the esClient.get POC is applied, setup can be switched to refresh:false for
 * faster iteration, but that is not the bottleneck being measured here.
 *
 * Usage:
 *   npx tsx bench-update-value-list-items-no-wait.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 25 50 100" \
 *     npx tsx bench-update-value-list-items-no-wait.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { KB_URL, parseNValues, kbPost, kbPut, kbDelete, printTable, fmtMs, perItem, extrapolate } from './bench-utils';

// Shares the same list and setup file as the baseline script — same items, different measurement.
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
    name: 'Bench value list (update no-wait)',
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

  console.log('=== Value List Update — no-wait (waitUntilDocumentIndexed fix) ===');
  console.log(`  Target  : ${KB_URL}`);
  console.log(`  N sweep : ${nValues.join(' ')}`);
  console.log(`  Setup   : ${hasSetupFile ? `pre-created items from ${SETUP_FILE}` : 'inline POST refresh:wait_for (~1s/item)'}`);
  console.log('  Requires: refresh:true default in update_list_item.ts');
  console.log('            + 1s sleep removed from wait_until_document_indexed.ts');
  console.log('  Before fix: ~1,000 ms/item (sleep still fires)');
  console.log('  After fix : ~20 ms/item');
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
    // Wait for ES to auto-refresh before the next sweep. With refresh:false, the previous
    // items sit in the translog. If the next sweep reuses the same items without a refresh,
    // updateByQuery sees a stale snapshot and gets version conflicts (updated:0).
    await new Promise((r) => setTimeout(r, 1500));
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
    const msPerItem = lastMs / lastN;
    console.log('');
    console.log(`  Customer extrapolation: ${extrapolate(msPerItem, 12_000)}`);
    if (msPerItem > 500) {
      console.log('  NOTE: Still ~1s/item — the waitUntilDocumentIndexed fix has not been applied yet.');
    } else {
      console.log('  Fix is active — waitUntilDocumentIndexed sleep removed successfully.');
    }
  }

  if (!preCreated) await kbDelete(`/api/lists?id=${LIST_ID}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
