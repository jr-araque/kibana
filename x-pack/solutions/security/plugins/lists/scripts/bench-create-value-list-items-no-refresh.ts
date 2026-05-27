/**
 * POC: Value List Create — refresh:false (requires esClient.get POC)
 *
 * Measures POST /api/lists/items with refresh:false — the patched path after
 * get_list_item.ts is refactored from esClient.search to esClient.get.
 *
 * Why refresh:false is safe only after the POC:
 *   The original code used esClient.search for read-back, which only sees segment-flushed
 *   documents. Without refresh:wait_for, an immediate read-back would return 404.
 *   After the POC, esClient.get reads from the translog — documents are visible
 *   immediately after write, so refresh:wait_for is no longer needed.
 *
 * Expected: ~20 ms/item (down from ~1,000 ms/item on the wait_for baseline).
 *
 * Requires: esClient.get POC applied in
 *   x-pack/solutions/security/plugins/lists/server/services/items/get_list_item.ts
 *
 * Usage:
 *   npx tsx bench-create-value-list-items-no-refresh.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100 200" \
 *     npx tsx bench-create-value-list-items-no-refresh.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import { KB_URL, parseNValues, kbPost, kbDelete, printTable, fmtMs, perItem, extrapolate } from './bench-utils';

const LIST_ID = 'bench-vl-nr-266239';

async function initDataStreams(): Promise<void> {
  const res = await kbPost('/api/lists/index', {});
  await res.json().catch(() => undefined);
}

async function resetList(): Promise<void> {
  await kbDelete(`/api/lists?id=${LIST_ID}`);
  const res = await kbPost('/api/lists', {
    id: LIST_ID,
    name: 'Bench value list (no_refresh)',
    description: '#266239 benchmark',
    type: 'keyword',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Create list: HTTP ${res.status} — ${body.message ?? JSON.stringify(body)}`);
  }
  await res.json();
}

async function run(n: number): Promise<number> {
  await resetList();
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const res = await kbPost('/api/lists/items', { list_id: LIST_ID, value: `kw-nr-${i}`, refresh: 'false' });
    if (!res.ok) throw new Error(`Create item ${i}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function main(): Promise<void> {
  const nValues = parseNValues();

  console.log('=== Value List Create — no_refresh (esClient.get POC) ===');
  console.log(`  Target : ${KB_URL}`);
  console.log(`  N sweep: ${nValues.join(' ')}`);
  console.log('  refresh:false — requires esClient.get POC in get_list_item.ts');
  console.log('  Expected: ~20 ms/item (50x improvement over wait_for baseline)');
  console.log('');

  process.stderr.write('  Init data streams … ');
  await initDataStreams();
  process.stderr.write('done\n\n');

  type Row = [number, number, string];
  const rows: Row[] = [];
  let lastMs = 0;
  let lastN = 0;

  for (const n of nValues) {
    process.stderr.write(`  N=${n} … `);
    const ms = await run(n);
    process.stderr.write(`done\n`);
    rows.push([n, ms, perItem(ms, n)]);
    lastMs = ms;
    lastN = n;
  }

  console.log('');
  printTable(
    [
      { header: 'N', width: 6 },
      { header: 'total ms', width: 12 },
      { header: 'ms/item', width: 10 },
    ],
    rows
  );

  if (lastN > 0) {
    console.log('');
    console.log(`  Customer extrapolation: ${extrapolate(lastMs / lastN, 12_000)}`);
  }

  await kbDelete(`/api/lists?id=${LIST_ID}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
