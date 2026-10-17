// Prints the text picture, legend and note of a saved get_map / edit_map answer (node scripts/mcp-picture.mjs <file>).
import fs from 'node:fs';
const t = fs.readFileSync(process.argv[2], 'utf8');
const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
const o = j.overview && typeof j.overview === 'object' && !Array.isArray(j.overview) && j.overview.overview ? j.overview : j;
for (const k of ['overview', 'legend', 'overviewNote']) {
  const v = o[k];
  if (v == null) continue;
  console.log(`--- ${k}`);
  console.log(typeof v === 'string' ? v : Array.isArray(v) ? v.join('\n') : JSON.stringify(v, null, 1));
}
