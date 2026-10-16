/**
 * Copy browser builds out of node_modules into vendor/.
 *
 * Why vendored: cdn.jsdelivr.net is unreachable on many networks (including
 * mainland China), which silently broke the WebTorrent client. Serving the
 * files ourselves removes the CDN from the critical path entirely.
 *
 * Dependabot bumps the exact versions in package.json; CI runs this script and
 * fails if vendor/ has drifted, so the two can never disagree.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = [
  ['peerjs',     'dist/peerjs.min.js',     'vendor/peerjs.min.js'],
  ['webtorrent', 'dist/webtorrent.min.js', 'vendor/webtorrent.min.js'],
  ['jszip',      'dist/jszip.min.js',      'vendor/jszip.min.js'],
];

mkdirSync('vendor', { recursive: true });
const versions = {};

for (const [pkg, from, to] of MAP) {
  const src = join('node_modules', pkg, from);
  if (!existsSync(src)) {
    console.error(`vendor: missing ${src} — run "npm ci" first`);
    process.exit(1);
  }
  copyFileSync(src, to);
  versions[pkg] = JSON.parse(readFileSync(join('node_modules', pkg, 'package.json'), 'utf8')).version;
  console.log(`vendor: ${to} <- ${pkg}@${versions[pkg]}`);
}

writeFileSync('vendor/VERSIONS.json', JSON.stringify(versions, null, 2) + '\n');
console.log('vendor: wrote vendor/VERSIONS.json');
