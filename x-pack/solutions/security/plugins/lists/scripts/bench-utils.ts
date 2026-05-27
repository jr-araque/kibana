/**
 * Shared config, HTTP helpers, and formatting utilities for benchmark scripts.
 *
 * Usage:
 *   KB_URL=http://localhost:5601 KB_AUTH=elastic:changeme N_VALUES="10 50 100" npx tsx bench-foo.ts
 */

export const KB_URL = process.env.KB_URL ?? 'http://localhost:5601';
export const KB_AUTH = process.env.KB_AUTH ?? 'elastic:changeme';

const [kbUser, kbPass] = KB_AUTH.split(':');
const BASE_HEADERS: Record<string, string> = {
  'kbn-xsrf': 'true',
  Authorization: `Basic ${Buffer.from(`${kbUser}:${kbPass}`).toString('base64')}`,
};

export function parseNValues(defaultValues = '10 25 50 100 200'): number[] {
  return (process.env.N_VALUES ?? defaultValues)
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function kbPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${KB_URL}${path}`, {
    method: 'POST',
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function kbGet(path: string): Promise<Response> {
  return fetch(`${KB_URL}${path}`, { headers: BASE_HEADERS });
}

export async function kbPut(path: string, body: unknown): Promise<Response> {
  return fetch(`${KB_URL}${path}`, {
    method: 'PUT',
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function kbDelete(path: string): Promise<void> {
  await fetch(`${KB_URL}${path}`, {
    method: 'DELETE',
    headers: BASE_HEADERS,
  }).catch(() => undefined);
}

// Multipart upload for _import endpoints.
// Accepts .txt or .csv filenames — the route validates the extension and rejects everything else.
// Manual body construction avoids Node.js fetch+FormData issues with custom headers.
export async function kbImport(
  path: string,
  content: string,
  filename = 'items.txt'
): Promise<Response> {
  const boundary = '----BenchMultipartBoundary7MA4YWxk';
  const CRLF = '\r\n';
  const bodyStr =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
    `Content-Type: text/plain${CRLF}` +
    `${CRLF}` +
    `${content}${CRLF}` +
    `--${boundary}--`;

  return fetch(`${KB_URL}${path}`, {
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.from(bodyStr),
  });
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

interface Col {
  header: string;
  width: number;
}

export function printTable(cols: Col[], rows: Array<Array<string | number>>): void {
  const cell = (v: string | number, w: number) => String(v).padEnd(w);
  console.log(cols.map((c) => cell(c.header, c.width)).join('  '));
  console.log(cols.map((c) => '-'.repeat(c.width)).join('  '));
  for (const row of rows) {
    console.log(row.map((v, i) => cell(v, cols[i].width)).join('  '));
  }
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

export function fmtMs(ms: number): string {
  if (ms < 1_000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function perItem(totalMs: number, n: number): string {
  return (totalMs / n).toFixed(1);
}

/**
 * Returns "2.3x" if ratio ≥ 1.05 else "1.0x (flat)".
 * Used to annotate growth ratios in analysis sections.
 */
export function growthLabel(actual: number, expected: number): string {
  const ratio = actual / expected;
  if (ratio > 1.1) return `${ratio.toFixed(2)}x (super-linear — O(N²) signal)`;
  if (ratio < 0.9) return `${ratio.toFixed(2)}x (sub-linear — amortisation)`;
  return `${ratio.toFixed(2)}x (≈ linear)`;
}

/**
 * Given per-item ms and a target item count, returns a formatted extrapolation string.
 * e.g. extrapolate(1015, 12000) → "1015.0 ms/item × 12,000 = 3.4 hours"
 */
export function extrapolate(msPerItem: number, targetN: number): string {
  const total = msPerItem * targetN;
  return `${msPerItem.toFixed(1)} ms/item × ${targetN.toLocaleString()} = ${fmtMs(total)}`;
}
