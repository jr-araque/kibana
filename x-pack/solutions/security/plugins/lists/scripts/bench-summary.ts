/**
 * Section 4 — Design Document Summary Table
 *
 * Consolidates results from the other three benchmark scripts into a single
 * copy-paste-ready table for the "Measured Performance (Benchmarks)" section
 * of the design document.
 *
 * This script runs all three benchmark suites inline and prints:
 *   1. The unified results table (all paths, all N values)
 *   2. Customer extrapolation to 12,000 items for each path
 *   3. Improvement multipliers (wait_for → no_refresh → _import)
 *
 * Usage (runs everything, uses same env vars as individual scripts):
 *   npx tsx bench-summary.ts
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100 200" \
 *     npx tsx bench-summary.ts
 *
 * Related issue: https://github.com/elastic/kibana/issues/266239
 */

import { KB_URL, parseNValues, kbPost, kbDelete, kbImport, fmtMs } from './bench-utils';

// ---------------------------------------------------------------------------
// List IDs — unique to this script so it can run alongside individual scripts
// ---------------------------------------------------------------------------
const VL_ID = 'bench-summary-vl-266239';
const EXC_ID = 'bench-summary-exc-266239';
const NS = 'single';

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

async function initDataStreams(): Promise<void> {
  const res = await kbPost('/api/lists/index', {});
  if (!res.ok) {
    const text = await res.text().catch(() => `(no body)`);
    throw new Error(`Init data streams: HTTP ${res.status} — ${text}`);
  }
}

async function createValueList(): Promise<void> {
  await kbDelete(`/api/lists?id=${VL_ID}`);
  const res = await kbPost('/api/lists', {
    id: VL_ID,
    name: 'Bench summary value list',
    description: '#266239 benchmark summary',
    type: 'keyword',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Create value list: HTTP ${res.status} — ${body.message ?? JSON.stringify(body)}`);
  }
  await res.json();
}

async function createExceptionList(): Promise<void> {
  await kbDelete(`/api/exception_lists?list_id=${EXC_ID}&namespace_type=${NS}`);
  const res = await kbPost('/api/exception_lists', {
    name: 'Bench summary exception list',
    description: '#266239 benchmark summary',
    list_id: EXC_ID,
    type: 'detection',
    namespace_type: NS,
  });
  if (!res.ok) throw new Error(`Create exception list: HTTP ${res.status}`);
  await res.json();
}

// ---------------------------------------------------------------------------
// Section 1: Value list create — wait_for, no_refresh, _import
// ---------------------------------------------------------------------------

async function measureVlWaitFor(n: number): Promise<number> {
  await createValueList();
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const res = await kbPost('/api/lists/items', { list_id: VL_ID, value: `s-wf-${i}` });
    if (!res.ok) throw new Error(`VL wait_for item ${i}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function measureVlNoRefresh(n: number): Promise<number> {
  await createValueList();
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const res = await kbPost('/api/lists/items', {
      list_id: VL_ID,
      value: `s-nr-${i}`,
      refresh: 'false',
    });
    if (!res.ok) throw new Error(`VL no_refresh item ${i}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

async function measureVlImport(n: number): Promise<number> {
  await createValueList();
  const content = Array.from({ length: n }, (_, i) => `s-imp-${i}`).join('\n');
  const t0 = Date.now();
  const res = await kbImport(`/api/lists/items/_import?list_id=${VL_ID}`, content);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`VL import: HTTP ${res.status} — ${body}`);
  }
  await res.json();
  return Date.now() - t0;
}

// ---------------------------------------------------------------------------
// Section 2: Exception list create — single-item POST + _import fast path
// ---------------------------------------------------------------------------

async function measureExcCreate(n: number): Promise<number> {
  await createExceptionList();
  const t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    const res = await kbPost('/api/exception_lists/items', {
      list_id: EXC_ID,
      namespace_type: NS,
      item_id: `s-exc-item-${i}`,
      name: `item-${i}`,
      description: 'bench',
      type: 'simple',
      entries: [{ field: 'host.name', operator: 'included', type: 'match', value: `host-${i}` }],
    });
    if (!res.ok) throw new Error(`Exc item ${i}: HTTP ${res.status}`);
    await res.json();
  }
  return Date.now() - t0;
}

// Exception list _import: one NDJSON object per line.
// Route validates .ndjson extension (returns 400 otherwise).
// Uses SO bulkCreate internally — validateExceptionListSize is never called.
async function measureExcImport(n: number): Promise<number> {
  await createExceptionList();
  const ndjson = Array.from({ length: n }, (_, i) =>
    JSON.stringify({
      description: 'bench',
      entries: [{ field: 'host.name', operator: 'included', type: 'match', value: `host-${i}` }],
      item_id: `s-exc-imp-item-${i}`,
      list_id: EXC_ID,
      name: `item-${i}`,
      type: 'simple',
      namespace_type: NS,
    })
  ).join('\n');

  const t0 = Date.now();
  const res = await kbImport('/api/exception_lists/_import?overwrite=true', ndjson, 'items.ndjson');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Exc import: HTTP ${res.status} — ${body}`);
  }
  await res.json();
  return Date.now() - t0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface NResult {
  n: number;
  vlWaitFor: number;
  vlNoRefresh: number;
  vlImport: number;
  excCreate: number;
  excImport: number;
}

async function main(): Promise<void> {
  const nValues = parseNValues('10 50 100 200');

  console.log('=== Section 4: Design Document Benchmark Summary ===');
  console.log(`  Target : ${KB_URL}`);
  console.log(`  N sweep: ${nValues.join(' ')}`);
  console.log('');
  console.log('  Running all benchmark suites. This will take several minutes.');
  console.log('  Progress on stderr; results table on stdout.');
  console.log('');

  process.stderr.write('  Init data streams … ');
  await initDataStreams();
  process.stderr.write('done\n\n');

  const results: NResult[] = [];

  for (const n of nValues) {
    process.stderr.write(`--- N=${n} ---\n`);

    process.stderr.write(`  VL wait_for (${n} POSTs ~${n}s) … `);
    const vlWaitFor = await measureVlWaitFor(n);
    process.stderr.write(`${vlWaitFor}ms\n`);

    process.stderr.write(`  VL no_refresh (${n} POSTs) … `);
    const vlNoRefresh = await measureVlNoRefresh(n);
    process.stderr.write(`${vlNoRefresh}ms\n`);

    process.stderr.write(`  VL _import (1 multipart upload) … `);
    const vlImport = await measureVlImport(n);
    process.stderr.write(`${vlImport}ms\n`);

    process.stderr.write(`  Exc create (${n} POSTs ~${n}s) … `);
    const excCreate = await measureExcCreate(n);
    process.stderr.write(`${excCreate}ms\n`);

    process.stderr.write(`  Exc _import (1 NDJSON upload) … `);
    const excImport = await measureExcImport(n);
    process.stderr.write(`${excImport}ms\n\n`);

    results.push({ n, vlWaitFor, vlNoRefresh, vlImport, excCreate, excImport });
  }

  // Cleanup
  await kbDelete(`/api/lists?id=${VL_ID}`);
  await kbDelete(`/api/exception_lists?list_id=${EXC_ID}&namespace_type=${NS}`);

  // ---------------------------------------------------------------------------
  // Print the unified design-doc table
  // ---------------------------------------------------------------------------

  const pad = (v: string | number, w: number) => String(v).padEnd(w);

  // Column widths for the doc-ready table
  const W = { n: 6, col: 22 };

  console.log('');
  console.log('=== Measured Performance (Benchmarks) ===');
  console.log('');
  const headers = [
    pad('N', W.n),
    pad('exc single ms/item', W.col),
    pad('exc _import ms/item', W.col),
    pad('vl wait_for ms/item', W.col),
    pad('vl no_refresh ms/item', W.col),
    pad('vl _import ms/item', W.col),
  ].join('  ');
  console.log(headers);
  console.log('-'.repeat(headers.length));

  for (const r of results) {
    console.log(
      [
        pad(r.n, W.n),
        pad((r.excCreate / r.n).toFixed(1), W.col),
        pad((r.excImport / r.n).toFixed(1), W.col),
        pad((r.vlWaitFor / r.n).toFixed(1), W.col),
        pad((r.vlNoRefresh / r.n).toFixed(1), W.col),
        pad((r.vlImport / r.n).toFixed(1), W.col),
      ].join('  ')
    );
  }

  // ---------------------------------------------------------------------------
  // Detailed per-N table with totals
  // ---------------------------------------------------------------------------

  console.log('');
  console.log('=== Detailed Results (totals + per-item) ===');
  console.log('');

  const hdr2 = [
    pad('N', 6),
    pad('exc single ms', 15),
    pad('exc/item', 10),
    pad('exc import ms', 15),
    pad('exc-imp/item', 14),
    pad('wf total ms', 13),
    pad('wf/item', 9),
    pad('nr total ms', 13),
    pad('nr/item', 9),
    pad('imp total ms', 13),
    pad('imp/item', 10),
  ].join('  ');
  console.log(hdr2);
  console.log('-'.repeat(hdr2.length));

  for (const r of results) {
    console.log(
      [
        pad(r.n, 6),
        pad(r.excCreate, 15),
        pad((r.excCreate / r.n).toFixed(1), 10),
        pad(r.excImport, 15),
        pad((r.excImport / r.n).toFixed(1), 14),
        pad(r.vlWaitFor, 13),
        pad((r.vlWaitFor / r.n).toFixed(1), 9),
        pad(r.vlNoRefresh, 13),
        pad((r.vlNoRefresh / r.n).toFixed(1), 9),
        pad(r.vlImport, 13),
        pad((r.vlImport / r.n).toFixed(1), 10),
      ].join('  ')
    );
  }

  // ---------------------------------------------------------------------------
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
