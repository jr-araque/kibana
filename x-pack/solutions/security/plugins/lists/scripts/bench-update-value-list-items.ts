/**
 * Section 2b — Value List: Update Path (PUT /api/lists/items)
 *
 * Measures per-item latency for PUT /api/lists/items and compares it to the create
 * baseline established by bench-create-value-list-items.ts.
 *
 * Root cause under test:
 *   updateListItem (services/items/update_list_item.ts) calls waitUntilDocumentIndexed
 *   after every updateByQuery. That function hardcodes a 1,000 ms sleep before polling
 *   getListItem to detect a version change:
 *
 *     const DEFAULT_INDEX_REFRESH_TIME = 1000;
 *     await new Promise((resolve) => setTimeout(resolve, DEFAULT_INDEX_REFRESH_TIME));
 *     await pRetry(fn, { minTimeout: DEFAULT_INDEX_REFRESH_TIME, retries: 5 });
 *
 *   This was introduced because updateByQuery only supports refresh:true/false (not
 *   wait_for), so the code polls manually. With esClient.search, the poll needed a
 *   full segment refresh to detect the version change — so the 1s sleep was necessary.
 *
 *   After the esClient.get POC (get_list_item.ts: search→get), getListItem reads from
 *   the translog in real time. The version change is visible immediately after
 *   updateByQuery — but the hardcoded 1s sleep still fires. The fix requires modifying
 *   waitUntilDocumentIndexed to skip the sleep when the read-back is real-time.
 *
 * Setup:
 *   N items created via single-item POST with refresh:false (fast path, ~20ms/item).
 *   Requires the esClient.get POC to be applied; without it set FAST_SETUP=false to
 *   fall back to the wait_for create path (~1s/item setup, much slower).
 *
 * Output:
 *   Table: N | setup ms | update total ms | ms/PUT
 *   Analysis: ratio vs create baseline, customer extrapolation
 *
 * Usage:
 *   npx tsx bench-update-value-list-items.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100 200" \
 *     npx tsx bench-update-value-list-items.ts
 *   FAST_SETUP=false npx tsx bench-update-value-list-items.ts   # wait_for setup
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import {
  KB_URL,
  parseNValues,
  kbPost,
  kbPut,
  kbDelete,
  printTable,
  fmtMs,
  perItem,
  extrapolate,
} from './bench-utils';

const LIST_ID = 'bench-vl-update-266239';
const FAST_SETUP = process.env.FAST_SETUP !== 'false'; // default true (requires esClient.get POC)

interface CreatedItem {
  id: string;
  value: string;
}

async function initDataStreams(): Promise<void> {
  const res = await kbPost('/api/lists/index', {});
  await res.json().catch(() => undefined);
}

async function setupItems(n: number): Promise<{ setupMs: number; items: CreatedItem[] }> {
  await kbDelete(`/api/lists?id=${LIST_ID}`);
  const listRes = await kbPost('/api/lists', {
    id: LIST_ID,
    name: 'Bench value list (update)',
    description: '#266239 benchmark',
    type: 'keyword',
  });
  if (!listRes.ok) {
    const body = (await listRes.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Create list: HTTP ${listRes.status} — ${body.message ?? JSON.stringify(body)}`);
  }
  await listRes.json();

  const items: CreatedItem[] = [];
  const t0 = Date.now();

  for (let i = 0; i < n; i++) {
    const value = `upd-v0-${i}`;
    const body: Record<string, string> = { list_id: LIST_ID, value };
    if (FAST_SETUP) {
      // refresh:false requires esClient.get POC in get_list_item.ts
      body.refresh = 'false';
    }
    const res = await kbPost('/api/lists/items', body);
    if (!res.ok) throw new Error(`Setup create item ${i}: HTTP ${res.status}`);
    const created = (await res.json()) as { id: string };
    items.push({ id: created.id, value });
  }

  return { setupMs: Date.now() - t0, items };
}

async function benchUpdates(items: CreatedItem[]): Promise<number> {
  const t0 = Date.now();
  for (let i = 0; i < items.length; i++) {
    const res = await kbPut('/api/lists/items', {
      id: items[i].id,
      value: `upd-v1-${i}`,
    });
    if (!res.ok) throw new Error(`PUT item ${items[i].id}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function main(): Promise<void> {
  const nValues = parseNValues('10 25 50 100');

  console.log('=== Section 2b: Value List — Update Path (PUT /api/lists/items) ===');
  console.log(`  Target    : ${KB_URL}`);
  console.log(`  N sweep   : ${nValues.join(' ')}`);
  console.log(
    `  Setup mode: ${FAST_SETUP ? 'POST refresh:false (fast, ~20ms/item; requires esClient.get POC)' : 'POST wait_for (slow, ~1s/item)'}`
  );
  console.log(
    '  Bottleneck: waitUntilDocumentIndexed in update_list_item.ts — hardcoded 1s sleep + pRetry'
  );
  console.log('  Expected  : ~1,000 ms/item regardless of setup path');
  console.log('');

  process.stderr.write('  Init data streams … ');
  await initDataStreams();
  process.stderr.write('done\n\n');

  type Row = [number, string, number, string];
  const rows: Row[] = [];
  let lastUpdateMs = 0;
  let lastN = 0;

  for (const n of nValues) {
    process.stderr.write(`  N=${n}: setup (${n} creates) … `);
    const { setupMs, items } = await setupItems(n);
    process.stderr.write(`PUT ${n} items … `);
    const updateMs = await benchUpdates(items);
    process.stderr.write(`done\n`);

    rows.push([n, fmtMs(setupMs), updateMs, perItem(updateMs, n)]);
    lastUpdateMs = updateMs;
    lastN = n;
  }

  console.log('');
  printTable(
    [
      { header: 'N', width: 6 },
      { header: 'setup time', width: 12 },
      { header: 'update total ms', width: 17 },
      { header: 'ms/PUT', width: 10 },
    ],
    rows
  );

  if (lastN > 0) {
    const msPerItem = lastUpdateMs / lastN;
    console.log('');
    console.log('=== Analysis ===');
    console.log(
      `  PUT /api/lists/items at N=${lastN}: ${msPerItem.toFixed(1)} ms/item`
    );
    console.log(
      '  Root cause: waitUntilDocumentIndexed hardcodes 1,000 ms sleep before polling _version'
    );
    console.log(
      '  This is a separate bottleneck from create path (refresh:wait_for) — same wall-clock cost, different mechanism'
    );
    console.log('');
    console.log('=== Customer extrapolation (12,000 value list item updates) ===');
    console.log(`  ${extrapolate(msPerItem, 12_000)}`);
    console.log('');
    console.log('=== Fix target ===');
    console.log(
      '  With esClient.get POC applied, _version is visible from translog immediately after updateByQuery.'
    );
    console.log(
      '  Removing the 1s upfront sleep from waitUntilDocumentIndexed (or replacing with a direct get+verify)'
    );
    console.log('  would reduce updates to ~20 ms/item — the same improvement as the create path fix.');
  }

  await kbDelete(`/api/lists?id=${LIST_ID}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
