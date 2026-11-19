// Converts an OSM file (.osm / .osm.gz / Overpass JSON) into the app's compact map format,
// using exactly the same parser the browser uses (parse.js), run inside a Node VM.
// Usage: node scripts/build-map.mjs input.osm data/bishkek.json
import fs from 'node:fs';
import vm from 'node:vm';
const [, , input, output] = process.argv;
if (!input || !output) { console.error('usage: node build-map.mjs <input.osm> <output.json>'); process.exit(1); }
const src = fs.readFileSync(new URL('../parse.js', import.meta.url), 'utf8');
let result = null, error = null;
const self = { postMessage(m) { if (m.type === 'done') result = m.data; else if (m.type === 'error') error = m.message; else if (m.type === 'progress') process.stdout.write(`\r${m.phase} ${m.read ? (m.read / 1e6).toFixed(0) + ' MB' : ''}      `); } };
const ctx = vm.createContext({ self, TextDecoder, ReadableStream, DecompressionStream, console });
vm.runInContext(src, ctx);
const buf = fs.readFileSync(input);
await self.onmessage({ data: { file: new File([buf], input.split('/').pop()) } });
process.stdout.write('\n');
if (error || !result) { console.error('parse failed:', error); process.exit(1); }
result.meta.updated = new Date().toISOString().slice(0, 10);
result.meta.source = 'OpenStreetMap contributors (ODbL)';
fs.mkdirSync(output.split('/').slice(0, -1).join('/') || '.', { recursive: true });
fs.writeFileSync(output, JSON.stringify(result));
const m = result.meta;
console.log(`OK: ${m.buildings} buildings (${m.known} with height), ${m.edges} walk edges, ${m.trees} trees → ${output} (${(fs.statSync(output).size / 1e6).toFixed(1)} MB)`);
