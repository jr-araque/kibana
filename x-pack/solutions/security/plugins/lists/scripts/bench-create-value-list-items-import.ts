/**
 * Fast path: Value List Create — _import (multipart upload)
 *
 * Measures POST /api/lists/items/_import — the existing bulk upload endpoint.
 * Internally uses a single esClient.bulk() call per 1,000-item chunk with one
 * refresh for the entire batch, amortising the ES refresh cost across all items.
 *
 * This is the performance target for the new JSON-body bulk endpoint. Any new
 * POST /api/lists/items/_bulk_create must match or approach this baseline.
 *
 * No code change required — this path already exists in all Kibana versions.
 * Limitation: accepts multipart/form-data only, not JSON request bodies, so it
 * cannot be used directly by IaC clients like Terraform.
 *
 * Expected: <1 ms/item at N=200 (3,800x faster than wait_for baseline).
 *
 * Usage:
 *   npx tsx bench-create-value-list-items-import.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100 200" \
 *     npx tsx bench-create-value-list-items-import.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import { KB_URL, parseNValues, kbPost, kbDelete, kbImport, printTable, fmtMs, perItem, extrapolate } from './bench-utils';

const LIST_ID = 'bench-vl-imp-266239';

async function initDataStreams(): Promise<void> {
  const res = await kbPost('/api/lists/index', {});
  if (!res.ok) {
    const text = await res.text().catch(() => `(no body)`);
    throw new Error(`Init data streams: HTTP ${res.status} — ${text}`);
  }
}

async function resetList(): Promise<void> {
  await kbDelete(`/api/lists?id=${LIST_ID}`);
  const res = await kbPost('/api/lists', {
    id: LIST_ID,
    name: 'Bench value list (_import)',
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
  const content = Array.from({ length: n }, (_, i) => `kw-imp-${i}`).join('\n');
  const t0 = Date.now();
  const res = await kbImport(`/api/lists/items/_import?list_id=${LIST_ID}`, content);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Import: HTTP ${res.status} — ${body}`);
  }
  await res.json();
  return Date.now() - t0;
}

async function main(): Promise<void> {
  const nValues = parseNValues();

  console.log('=== Value List Create — _import fast path ===');
  console.log(`  Target : ${KB_URL}`);
  console.log(`  N sweep: ${nValues.join(' ')}`);
  console.log('  _import — 1 esClient.bulk() per 1,000 items, 1 refresh for the batch');
  console.log('  This is the performance target for the new JSON-body bulk endpoint');
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
