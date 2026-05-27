/**
 * Section 1 — Value List: Create Path Comparison
 *
 * Compares three creation paths for POST /api/lists/items:
 *
 *   wait_for   — default single-item POST (refresh:wait_for, ~1s/item baseline)
 *   no_refresh — single-item POST with refresh:false (requires get_list_item.ts to use
 *                esClient.get instead of esClient.search; see POC in #266239)
 *   _import    — single multipart upload via POST /api/lists/items/_import
 *                (ES bulk, amortises refresh across the batch — fast path target)
 *
 * Output columns:
 *   N | wait_for total | wf/item | no_refresh total | nr/item | _import total | imp/item
 *   + speedup ratios + extrapolation to 12,000 items
 *
 * Usage:
 *   npx tsx bench-create-value-list-items.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100 200" \
 *     npx tsx bench-create-value-list-items.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import {
  KB_URL,
  parseNValues,
  kbPost,
  kbDelete,
  kbImport,
  printTable,
  fmtMs,
  perItem,
} from './bench-utils';

const LIST_ID = 'bench-vl-create-266239';

async function initDataStreams(): Promise<void> {
  // Idempotent — creates the .lists-* and .items-* data streams if they don't exist yet.
  const res = await kbPost('/api/lists/index', {});
  await res.json().catch(() => undefined);
}

async function resetList(): Promise<void> {
  await kbDelete(`/api/lists?id=${LIST_ID}`);
  const res = await kbPost('/api/lists', {
    id: LIST_ID,
    name: 'Bench value list (create)',
    description: '#266239 benchmark',
    type: 'keyword',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Create list: HTTP ${res.status} — ${body.message ?? JSON.stringify(body)}`);
  }
  await res.json();
}

async function runWaitFor(n: number): Promise<number> {
  await resetList();
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const res = await kbPost('/api/lists/items', { list_id: LIST_ID, value: `kw-wf-${i}` });
    if (!res.ok) throw new Error(`Create item ${i} (wait_for): HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function runNoRefresh(n: number): Promise<number> {
  await resetList();
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const res = await kbPost('/api/lists/items', {
      list_id: LIST_ID,
      value: `kw-nr-${i}`,
      refresh: 'false',
    });
    if (!res.ok) throw new Error(`Create item ${i} (no_refresh): HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function runImport(n: number): Promise<number> {
  await resetList();
  // Plain text: one value per line. Route only accepts .txt/.csv filenames.
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

  console.log('=== Section 1: Value List — Create Path Comparison ===');
  console.log(`  Target : ${KB_URL}`);
  console.log(`  N sweep: ${nValues.join(' ')}`);
  console.log('  Scenarios:');
  console.log('    wait_for   — single-item POST, refresh:wait_for (baseline, ~1s/item)');
  console.log('    no_refresh — single-item POST, refresh:false (requires esClient.get POC)');
  console.log('    _import    — multipart bulk upload, 1 refresh for entire batch (fast path)');
  console.log('');

  process.stderr.write('  Init data streams … ');
  await initDataStreams();
  process.stderr.write('done\n\n');

  type Row = [number, number, string, number, string, number, string, string, string];
  const rows: Row[] = [];

  for (const n of nValues) {
    process.stderr.write(`  N=${n}: wait_for … `);
    const wfMs = await runWaitFor(n);
    process.stderr.write(`no_refresh … `);
    const nrMs = await runNoRefresh(n);
    process.stderr.write(`_import … `);
    const impMs = await runImport(n);
    process.stderr.write(`done\n`);

    const wfNr = (wfMs / nrMs).toFixed(1);
    const nrImp = (nrMs / impMs).toFixed(1);

    rows.push([
      n,
      wfMs,
      perItem(wfMs, n),
      nrMs,
      perItem(nrMs, n),
      impMs,
      perItem(impMs, n),
      `${wfNr}x`,
      `${nrImp}x`,
    ]);
  }

  console.log('');
  printTable(
    [
      { header: 'N', width: 6 },
      { header: 'wait_for ms', width: 14 },
      { header: 'wf/item', width: 9 },
      { header: 'no_refresh ms', width: 15 },
      { header: 'nr/item', width: 9 },
      { header: '_import ms', width: 12 },
      { header: 'imp/item', width: 10 },
      { header: 'wf/nr', width: 8 },
      { header: 'nr/imp', width: 8 },
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
