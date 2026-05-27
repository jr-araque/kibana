/**
 * Setup: pre-create value list items for update benchmarks
 *
 * Creates N value list items via POST /api/lists/items/_import (one bulk call),
 * then fetches their IDs with GET /api/lists/items/_find and writes everything to
 * bench-update-items.json. The update benchmark scripts load from this file,
 * skipping all setup cost on subsequent runs.
 *
 * Why _import instead of N individual POSTs:
 *   _import uses esClient.bulk() internally — one ES call + one refresh for the
 *   whole batch. N individual POSTs each block on refresh:wait_for (~1s each).
 *   For N=100 that is ~100s of setup vs ~1s with _import.
 *
 * Run once before benchmarking:
 *   npx tsx bench-update-value-list-items-setup.ts          # N=100 (default)
 *   N_ITEMS=200 npx tsx bench-update-value-list-items-setup.ts
 *
 * Then run benchmarks without setup cost:
 *   npx tsx bench-update-value-list-items-baseline.ts
 *   npx tsx bench-update-value-list-items-no-wait.ts
 *
 * To recreate items from scratch:
 *   npx tsx bench-update-value-list-items-setup.ts --reset
 *
 * bench-update-items.json is gitignored — local state only.
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { KB_URL, kbPost, kbGet, kbDelete, kbImport } from './bench-utils';

const LIST_ID = 'bench-vl-upd-baseline-266239';
const OUTPUT_FILE = join(__dirname, 'bench-update-items.json');
const N_ITEMS = parseInt(process.env.N_ITEMS ?? '100', 10);
const RESET = process.argv.includes('--reset');

interface Item { id: string; value: string }
interface SetupFile { listId: string; items: Item[]; createdAt: string }

async function initDataStreams(): Promise<void> {
  const res = await kbPost('/api/lists/index', {});
  if (!res.ok) {
    const text = await res.text().catch(() => `(no body)`);
    throw new Error(`Init data streams: HTTP ${res.status} — ${text}`);
  }
}

async function fetchAllItems(listId: string, n: number): Promise<Item[]> {
  // _import uses bulk without refresh:wait_for, so items may not be visible immediately.
  // Poll until the expected count appears or we time out (~5s).
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await kbGet(
      `/api/lists/items/_find?list_id=${listId}&page=1&per_page=${n}`
    );
    if (!res.ok) {
      const text = await res.text().catch(() => `(no body)`);
      throw new Error(`Find items: HTTP ${res.status} — ${text}`);
    }
    const body = (await res.json()) as { data: Array<{ id: string; keyword?: string; [k: string]: unknown }> };
    if (body.data.length >= n) {
      return body.data.map((item) => ({
        id: item.id,
        value: String(item.keyword ?? item.ip ?? item.long ?? item.double ?? item.float ?? item.text ?? ''),
      }));
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return [];
}

async function main(): Promise<void> {
  console.log('=== Value List Update — Setup ===');
  console.log(`  Target  : ${KB_URL}`);
  console.log(`  N items : ${N_ITEMS}`);
  console.log(`  Output  : ${OUTPUT_FILE}`);
  console.log('');

  process.stderr.write('  Init data streams … ');
  await initDataStreams();
  process.stderr.write('done\n');

  if (RESET) {
    process.stderr.write(`  Deleting list ${LIST_ID} … `);
    await kbDelete(`/api/lists?id=${LIST_ID}`);
    process.stderr.write('done\n');
  }

  process.stderr.write(`  Creating list ${LIST_ID} … `);
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
  process.stderr.write('done\n');

  // Build plain-text content for _import: one value per line.
  const values = Array.from({ length: N_ITEMS }, (_, i) => `upd-setup-${i}`);
  const content = values.join('\n');

  process.stderr.write(`  Importing ${N_ITEMS} items via _import … `);
  const t0 = Date.now();
  const importRes = await kbImport(`/api/lists/items/_import?list_id=${LIST_ID}`, content);
  if (!importRes.ok) {
    const text = await importRes.text().catch(() => `(no body)`);
    throw new Error(`Import: HTTP ${importRes.status} — ${text}`);
  }
  await importRes.json();
  const importMs = Date.now() - t0;
  process.stderr.write(`done (${importMs}ms)\n`);

  process.stderr.write(`  Fetching item IDs via _find … `);
  const items = await fetchAllItems(LIST_ID, N_ITEMS);
  process.stderr.write(`done (${items.length} items)\n`);

  if (items.length < N_ITEMS) {
    console.warn(`  WARN: expected ${N_ITEMS} items but got ${items.length}. Re-run with --reset.`);
  }

  const setupFile: SetupFile = { listId: LIST_ID, items, createdAt: new Date().toISOString() };
  writeFileSync(OUTPUT_FILE, JSON.stringify(setupFile, null, 2));

  console.log('');
  console.log(`  Import  : ${importMs}ms total (${(importMs / N_ITEMS).toFixed(1)} ms/item)`);
  console.log(`  Items   : ${items.length} IDs saved to ${OUTPUT_FILE}`);
  console.log('');
  console.log('  Run benchmarks:');
  console.log('    npx tsx bench-update-value-list-items-baseline.ts');
  console.log('    npx tsx bench-update-value-list-items-no-wait.ts');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
