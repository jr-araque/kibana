/**
 * Section 3b — Exception List: GET Latency
 *
 * Measures per-item GET latency for GET /api/exception_lists/items?item_id=&list_id=&namespace_type=.
 *
 * The current implementation uses savedObjectsClient.find filtered by item_id.
 * If find() scans all items in the list, ms/GET will grow with N → O(N) reads per GET → O(N²) total.
 * If item_id is properly indexed, ms/GET stays flat across N.
 *
 * Setup: items are created via single-item POST (only path available for exception list items).
 * Setup is slow (~1s/item) due to refresh:wait_for; keep default N_VALUES small.
 * Override via N_VALUES env var for larger sweeps (will take longer).
 *
 * Expected signal:
 *   - flat ms/GET across N → SO lookup is O(1) (item_id index is effective)
 *   - ms/GET growing with N → find() scans list items, reads degrade at scale
 *
 * Usage:
 *   npx tsx bench-get-exception-list-items.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 25 50 100" \
 *     npx tsx bench-get-exception-list-items.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import {
  KB_URL,
  parseNValues,
  kbPost,
  kbGet,
  kbDelete,
  printTable,
  fmtMs,
  perItem,
} from './bench-utils';

const LIST_ID = 'bench-exc-get-266239';
const NS = 'single';

function itemId(i: number): string {
  return `bench-exc-get-item-${i}`;
}

async function setupItems(n: number): Promise<number> {
  await kbDelete(`/api/exception_lists?list_id=${LIST_ID}&namespace_type=${NS}`);
  const listRes = await kbPost('/api/exception_lists', {
    name: 'Bench exception list (get)',
    description: '#266239 benchmark',
    list_id: LIST_ID,
    type: 'detection',
    namespace_type: NS,
  });
  if (!listRes.ok) throw new Error(`Create list: HTTP ${listRes.status}`);
  await listRes.json();

  const t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    const res = await kbPost('/api/exception_lists/items', {
      list_id: LIST_ID,
      namespace_type: NS,
      item_id: itemId(i),
      name: `item-${i}`,
      description: 'bench',
      type: 'simple',
      entries: [{ field: 'host.name', operator: 'included', type: 'match', value: `host-${i}` }],
    });
    if (!res.ok) throw new Error(`Setup item ${i}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function benchGets(n: number): Promise<number> {
  const t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    const res = await kbGet(
      `/api/exception_lists/items?item_id=${itemId(i)}&list_id=${LIST_ID}&namespace_type=${NS}`
    );
    if (!res.ok) throw new Error(`GET item ${i}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function main(): Promise<void> {
  // Smaller default N: setup creates items via single-item POST (~1s/item).
  const nValues = parseNValues('10 25 50 100');

  console.log('=== Section 3b: Exception List — GET Latency ===');
  console.log(`  Target : ${KB_URL}`);
  console.log(`  N sweep: ${nValues.join(' ')}`);
  console.log('  Each N: fresh list + N creates (setup, ~1s/item) + N GETs (benchmark)');
  console.log('  savedObjectsClient.find by item_id — checking if O(1) or O(list size)');
  console.log('');

  type Row = [number, string, number, string];
  const rows: Row[] = [];

  for (const n of nValues) {
    process.stderr.write(`  N=${n}: setup (${n} creates ~${n}s) … `);
    const setupMs = await setupItems(n);
    process.stderr.write(`GET ${n} items … `);
    const getMs = await benchGets(n);
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

  await kbDelete(`/api/exception_lists?list_id=${LIST_ID}&namespace_type=${NS}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
