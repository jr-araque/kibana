/**
 * Baseline: Value List Create — refresh:wait_for (current default behaviour)
 *
 * Measures POST /api/lists/items with the default refresh param.
 * create_list_item.ts sets refresh:'wait_for', which blocks the ES response until the
 * shard is refreshed (~1 second). This is the unpatched baseline that causes the
 * ~3h16m customer wall-clock time at 12,000 items.
 *
 * No POC or code change required — runs against any Kibana version.
 *
 * Usage:
 *   npx tsx bench-create-value-list-items-wait-for.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100 200" \
 *     npx tsx bench-create-value-list-items-wait-for.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import { KB_URL, parseNValues, kbPost, kbDelete, printTable, fmtMs, perItem, extrapolate } from './bench-utils';

const LIST_ID = 'bench-vl-wf-266239';

async function initDataStreams(): Promise<void> {
  const res = await kbPost('/api/lists/index', {});
  await res.json().catch(() => undefined);
}

async function resetList(): Promise<void> {
  await kbDelete(`/api/lists?id=${LIST_ID}`);
  const res = await kbPost('/api/lists', {
    id: LIST_ID,
    name: 'Bench value list (wait_for)',
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
    const res = await kbPost('/api/lists/items', { list_id: LIST_ID, value: `kw-wf-${i}` });
    if (!res.ok) throw new Error(`Create item ${i}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function main(): Promise<void> {
  const nValues = parseNValues();

  console.log('=== Value List Create — wait_for baseline ===');
  console.log(`  Target : ${KB_URL}`);
  console.log(`  N sweep: ${nValues.join(' ')}`);
  console.log('  refresh:wait_for — blocks ~1s/item until ES shard refreshes');
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
