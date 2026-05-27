/**
 * Benchmark: Create Exception List Items — wait_for vs refresh:false
 *
 * Usage:
 *   npx tsx bench-create-exception-list-items.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100 200" \
 *     npx tsx bench-create-exception-list-items.ts
 */

import { KB_URL, parseNValues, kbPost, kbDelete, printTable, fmtMs, perItem } from './bench-utils';

const LIST_ID = 'bench-exc-create-266239';
const NS = 'single';

async function resetList(): Promise<void> {
  await kbDelete(`/api/exception_lists?list_id=${LIST_ID}&namespace_type=${NS}`);
  const res = await kbPost('/api/exception_lists', {
    name: 'Bench exception list (create)',
    description: '#266239 benchmark',
    list_id: LIST_ID,
    type: 'detection',
    namespace_type: NS,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Create list: HTTP ${res.status} — ${body}`);
  }
  await res.json();
}

async function runWaitFor(n: number): Promise<number> {
  await resetList();
  const t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    const res = await kbPost('/api/exception_lists/items', {
      list_id: LIST_ID,
      namespace_type: NS,
      item_id: `bench-exc-wf-item-${i}`,
      name: `item-${i}`,
      description: 'bench',
      type: 'simple',
      entries: [{ field: 'host.name', operator: 'included', type: 'match', value: `host-${i}` }],
    });
    if (!res.ok) throw new Error(`Create item ${i} (wait_for): HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function runNoRefresh(n: number): Promise<number> {
  await resetList();
  const t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    const res = await kbPost('/api/exception_lists/items?refresh=false', {
      list_id: LIST_ID,
      namespace_type: NS,
      item_id: `bench-exc-nr-item-${i}`,
      name: `item-${i}`,
      description: 'bench',
      type: 'simple',
      entries: [{ field: 'host.name', operator: 'included', type: 'match', value: `host-${i}` }],
    });
    if (!res.ok) throw new Error(`Create item ${i} (no_refresh): HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function main(): Promise<void> {
  const nValues = parseNValues('10 25 50 100');

  process.stderr.write(`Target: ${KB_URL}  N: ${nValues.join(' ')}\n\n`);

  type Row = [number, number, string, number, string, string];
  const rows: Row[] = [];

  for (const n of nValues) {
    process.stderr.write(`  N=${n}: wait_for … `);
    const wfMs = await runWaitFor(n);
    process.stderr.write(`no_refresh … `);
    const nrMs = await runNoRefresh(n);
    process.stderr.write(`done\n`);
    rows.push([n, wfMs, perItem(wfMs, n), nrMs, perItem(nrMs, n), `${(wfMs / nrMs).toFixed(1)}x`]);
  }

  console.log('');
  printTable(
    [
      { header: 'N', width: 6 },
      { header: 'wait_for ms', width: 13 },
      { header: 'wf/item', width: 9 },
      { header: 'no_refresh ms', width: 15 },
      { header: 'nr/item', width: 9 },
      { header: 'speedup', width: 9 },
    ],
    rows
  );

  await kbDelete(`/api/exception_lists?list_id=${LIST_ID}&namespace_type=${NS}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
