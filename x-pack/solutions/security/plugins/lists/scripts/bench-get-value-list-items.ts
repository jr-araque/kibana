/**
 * Section 3a — Value List: GET Latency
 *
 * Measures per-item GET latency for GET /api/lists/items?id=&list_id=.
 *
 * The post-POC implementation uses esClient.get, which reads by document ID from
 * the shard/translog in real-time — O(1) regardless of list size.
 * Before the POC, esClient.search was used; that required a refreshed segment and
 * forced create_list_item.ts to block on refresh:wait_for so read-back would not 404.
 *
 * Setup: items are created via _import (fast — one refresh for the batch) so setup
 * time does not dominate the benchmark at large N.
 *
 * Expected signal:
 *   - ms/GET flat across N → esClient.get is O(1), confirming the search→get refactor
 *     does not degrade read performance at scale.
 *   - ms/GET growing with N → something in the read path scans the list (regression).
 *
 * Usage:
 *   npx tsx bench-get-value-list-items.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100 200" \
 *     npx tsx bench-get-value-list-items.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import {
  KB_URL,
  parseNValues,
  kbPost,
  kbGet,
  kbDelete,
  kbImport,
  printTable,
  fmtMs,
  perItem,
} from './bench-utils';

const LIST_ID = 'bench-vl-get-266239';

// Item IDs must be deterministic so we can GET them back after import.
// _import does not accept explicit IDs — Kibana assigns IDs based on value.
// We POST individual items with explicit IDs so we can GET by id later.
// To keep setup fast, we use refresh:false (requires esClient.get POC).
// If the POC is not applied, remove refresh:false and accept ~1s/item setup cost.
const FAST_SETUP = process.env.FAST_SETUP !== 'false'; // default true

function itemValue(i: number): string {
  return `bench-vl-get-v-${i}`;
}

async function initDataStreams(): Promise<void> {
  const res = await kbPost('/api/lists/index', {});
  if (!res.ok) {
    const text = await res.text().catch(() => `(no body)`);
    throw new Error(`Init data streams: HTTP ${res.status} — ${text}`);
  }
}

async function setupItems(n: number): Promise<{ setupMs: number; itemIds: string[] }> {
  await kbDelete(`/api/lists?id=${LIST_ID}`);
  const listRes = await kbPost('/api/lists', {
    id: LIST_ID,
    name: 'Bench value list (get)',
    description: '#266239 benchmark',
    type: 'keyword',
  });
  if (!listRes.ok) {
    const body = (await listRes.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Create list: HTTP ${listRes.status} — ${body.message ?? JSON.stringify(body)}`);
  }
  await listRes.json();

  const t0 = Date.now();
  const itemIds: string[] = [];

  if (FAST_SETUP) {
    // Use _import for bulk creation — one refresh for the whole batch.
    // We won't have explicit IDs from this path, so we GET by value instead.
    const content = Array.from({ length: n }, (_, i) => itemValue(i)).join('\n');
    const res = await kbImport(`/api/lists/items/_import?list_id=${LIST_ID}`, content);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Import setup: HTTP ${res.status} — ${body}`);
    }
    const result = (await res.json()) as { items?: Array<{ id: string }> };
    // Collect IDs from import response if available; otherwise we'll GET by value
    if (result.items) {
      for (const item of result.items) {
        itemIds.push(item.id);
      }
    }
  } else {
    // Slow path: single-item POST with known IDs (for wait_for environments)
    for (let i = 0; i < n; i++) {
      const body: Record<string, string> = {
        list_id: LIST_ID,
        value: itemValue(i),
        refresh: 'false',
      };
      const res = await kbPost('/api/lists/items', body);
      if (!res.ok) throw new Error(`Setup item ${i}: HTTP ${res.status}`);
      const created = (await res.json()) as { id: string };
      itemIds.push(created.id);
    }
  }

  const setupMs = Date.now() - t0;
  return { setupMs, itemIds };
}

async function benchGetsByValue(n: number): Promise<number> {
  // GET items by value — works regardless of which setup path was used
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const value = encodeURIComponent(itemValue(i));
    const res = await kbGet(`/api/lists/items?list_id=${LIST_ID}&value=${value}`);
    if (!res.ok) throw new Error(`GET item ${i} by value: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function benchGetsById(itemIds: string[]): Promise<number> {
  const t0 = Date.now();
  for (const id of itemIds) {
    const res = await kbGet(`/api/lists/items?id=${id}&list_id=${LIST_ID}`);
    if (!res.ok) throw new Error(`GET item ${id}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function main(): Promise<void> {
  const nValues = parseNValues();

  console.log('=== Section 3a: Value List — GET Latency ===');
  console.log(`  Target    : ${KB_URL}`);
  console.log(`  N sweep   : ${nValues.join(' ')}`);
  console.log(`  Setup mode: ${FAST_SETUP ? '_import (fast, one refresh per batch)' : 'single POST refresh:false'}`);
  console.log('  Each N: fresh list + import N items (setup) + GET each item (benchmark)');
  console.log('  esClient.get reads by ID from translog — expected O(1) regardless of list size');
  console.log('');

  process.stderr.write('  Init data streams … ');
  await initDataStreams();
  process.stderr.write('done\n\n');

  type Row = [number, string, number, string];
  const rows: Row[] = [];

  for (const n of nValues) {
    process.stderr.write(`  N=${n}: setup (import ${n} items) … `);
    const { setupMs, itemIds } = await setupItems(n);
    process.stderr.write(`GET ${n} items … `);

    // Prefer GET by id when available (tests esClient.get directly), fall back to value
    const getMs =
      itemIds.length === n ? await benchGetsById(itemIds) : await benchGetsByValue(n);

    process.stderr.write(`done\n`);
    rows.push([n, fmtMs(setupMs), getMs, perItem(getMs, n)]);
  }

  console.log('');
  printTable(
    [
      { header: 'N', width: 6 },
      { header: 'setup time', width: 12 },
      { header: 'get total ms', width: 14 },
      { header: 'ms/GET', width: 10 },
    ],
    rows
  );

  await kbDelete(`/api/lists?id=${LIST_ID}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
