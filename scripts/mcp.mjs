// A small stdio MCP client for the generator's MCP server: how an AI author talks to it, from a shell.
//   node scripts/mcp.mjs tools                         list the tools (name + first line of the description)
//   node scripts/mcp.mjs schema <tool>                 a tool's full description and input schema
//   node scripts/mcp.mjs call <tool> '<json args>'     call a tool; text content is printed, images are saved
//   node scripts/mcp.mjs call <tool> @args.json        arguments from a file
//   node scripts/mcp.mjs calls @calls.json             several calls in ONE session ([{tool, args}, …]), so a
//                                                      use_project at the start holds for the rest
// Options: --out <dir> where image content goes (default test-results/mcp), --name <base> the image file name,
// --project <name> runs use_project first (FB-046 fixed: later calls leave `project` out; maps given by name are
// also inferred from their project, so most map calls need neither).
// It spawns `ssg mcp` (the generator's own MCP server) with SSG_ALLOWED_DIRS set to this repo, exactly like the
// `synty-sprites` entry in .mcp.json. Every call is appended to test-results/mcp-calls.jsonl (tool, args, timing,
// size of the answer, error flag) for the FEEDBACK notes.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSG = process.env.SSG_BIN ?? '/home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  if (i < 0) return d;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const outDir = path.resolve(root, opt('--out', 'test-results/mcp'));
const baseName = opt('--name', null);
const project = opt('--project', null);
const [cmd, tool, rawArgs] = argv;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SSG, 'mcp'],
  env: { ...process.env, SSG_ALLOWED_DIRS: root },
  stderr: 'pipe',
});
let serverErr = '';
transport.stderr?.on('data', (d) => (serverErr += d));
const client = new Client({ name: 'airborne-ranger-author', version: '0.1.0' });
await client.connect(transport);

/** One tool call: text printed, images saved, a line in test-results/mcp-calls.jsonl. */
async function callOne(tool, args) {
  const t0 = Date.now();
  const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 15 * 60 * 1000 });
  const ms = Date.now() - t0;
  let textChars = 0;
  const images = [];
  for (const [k, c] of (res.content ?? []).entries()) {
    if (c.type === 'text') {
      textChars += c.text.length;
      console.log(c.text);
    } else if (c.type === 'image') {
      fs.mkdirSync(outDir, { recursive: true });
      const ext = c.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const f = path.join(outDir, `${baseName ?? `${tool}-${Date.now()}`}${k ? `-${k}` : ''}.${ext}`);
      fs.writeFileSync(f, Buffer.from(c.data, 'base64'));
      images.push(path.relative(root, f));
      console.log(`[image ${c.mimeType} → ${path.relative(root, f)}]`);
    } else {
      console.log(`[${c.type} content]`, JSON.stringify(c).slice(0, 400));
    }
  }
  if (res.structuredContent) console.log('[structuredContent]', JSON.stringify(res.structuredContent).slice(0, 2000));
  if (res.isError) console.log('[isError: true]');
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.appendFileSync(path.join(root, 'test-results/mcp-calls.jsonl'), JSON.stringify({ at: new Date().toISOString(), tool, args, ms, textChars, images, isError: !!res.isError }) + '\n');
  if (res.isError) process.exitCode = 2;
}

try {
  if (cmd === 'tools') {
    const { tools } = await client.listTools();
    for (const t of tools) console.log(`${t.name.padEnd(22)} ${(t.description ?? '').split('\n')[0].slice(0, 140)}`);
  } else if (cmd === 'schema') {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === tool);
    if (!t) throw new Error(`no tool ${tool}`);
    console.log(t.description);
    console.log(JSON.stringify(t.inputSchema, null, 2));
  } else if (cmd === 'call' || cmd === 'calls') {
    const load = (raw) => (!raw ? {} : raw.startsWith('@') ? JSON.parse(fs.readFileSync(path.resolve(root, raw.slice(1)), 'utf8')) : JSON.parse(raw));
    const list = cmd === 'call' ? [{ tool, args: load(rawArgs) }] : load(tool);
    if (project) list.unshift({ tool: 'use_project', args: { project } });
    for (const c of list) await callOne(c.tool, c.args ?? {});
  } else {
    console.error('usage: node scripts/mcp.mjs [--project <name>] tools | schema <tool> | call <tool> <json|@file> | calls <json|@file>');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`mcp: ${e.message}`);
  if (serverErr.trim()) console.error(`server stderr: ${serverErr.trim().slice(-1500)}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
