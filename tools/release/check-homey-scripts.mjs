#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_MAPPING = path.join(ROOT, 'release', 'homey-scripts.json');

function parseArgs(argv) {
  const args = {
    mapping: DEFAULT_MAPPING,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'expected' || arg === 'verify') args.command = arg;
    else if (arg === '--mapping') args.mapping = path.resolve(ROOT, argv[++i]);
    else if (arg === '--remote-file') args.remoteFile = path.resolve(ROOT, argv[++i]);
    else if (arg === '--out') args.out = path.resolve(ROOT, argv[++i]);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node tools/release/check-homey-scripts.mjs expected [--out <file>]
  node tools/release/check-homey-scripts.mjs verify --remote-file <file>

Commands:
  expected        Generate the expected local HomeyScripts manifest.
  verify          Compare local scripts with a remote export JSON.

Remote export format:
{
  "scripts": [
    {
      "name": "Irrigation",
      "remoteName": "Irrigation System.js",
      "homeyScriptId": "...",
      "content": "..."
    }
  ]
}

The tool compares normalized LF content by script name, remote name or HomeyScript
ID and reports:
  OK       same content;
  MISSING  script not present in the remote export;
  DRIFT    remote content differs from local;
  EXTRA    remote export contains a script not declared in release/homey-scripts.json.
`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function normalizeContent(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function sha256Text(value) {
  return createHash('sha256').update(normalizeContent(value)).digest('hex');
}

async function readLocalScript(script) {
  const absolutePath = path.resolve(ROOT, script.localPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing local script: ${script.localPath}`);
  }

  return normalizeContent(await readFile(absolutePath, 'utf8'));
}

async function buildExpectedManifest(mapping) {
  const scripts = [];
  for (const script of mapping.scripts || []) {
    const content = await readLocalScript(script);
    scripts.push({
      name: script.name,
      remoteName: script.remoteName ?? script.name,
      localPath: script.localPath,
      homeyScriptId: script.homeyScriptId ?? null,
      deprecated: Boolean(script.deprecated),
      sha256: sha256Text(content),
      bytes: Buffer.byteLength(content, 'utf8'),
    });
  }

  return {
    schemaVersion: 1,
    component: mapping.component,
    version: mapping.version,
    generatedAt: new Date().toISOString(),
    scripts,
  };
}

async function verify(mapping, remoteFile) {
  if (!remoteFile) {
    throw new Error('Missing required --remote-file for verify');
  }

  const remote = await readJson(remoteFile);
  const remoteByName = new Map();
  const remoteById = new Map();
  for (const script of remote.scripts || []) {
    if (script.name) remoteByName.set(script.name, script);
    if (script.remoteName) remoteByName.set(script.remoteName, script);
    if (script.homeyScriptId) remoteById.set(script.homeyScriptId, script);
  }

  const expectedKeys = new Set();
  for (const script of mapping.scripts || []) {
    expectedKeys.add(script.name);
    expectedKeys.add(script.remoteName ?? script.name);
    if (script.homeyScriptId) expectedKeys.add(script.homeyScriptId);
  }
  const results = [];

  for (const script of mapping.scripts || []) {
    const localContent = await readLocalScript(script);
    const localHash = sha256Text(localContent);
    const remoteScript =
      (script.homeyScriptId ? remoteById.get(script.homeyScriptId) : null) ||
      remoteByName.get(script.remoteName ?? script.name) ||
      remoteByName.get(script.name);

    if (!remoteScript) {
      results.push({
        name: script.name,
        remoteName: script.remoteName ?? script.name,
        status: 'MISSING',
        homeyScriptId: script.homeyScriptId ?? null,
        localSha256: localHash,
      });
      continue;
    }

    const remoteHash = remoteScript.sha256 || sha256Text(remoteScript.content || '');
    results.push({
      name: script.name,
      remoteName: script.remoteName ?? script.name,
      status: remoteHash === localHash ? 'OK' : 'DRIFT',
      homeyScriptId: remoteScript.homeyScriptId ?? script.homeyScriptId ?? null,
      localSha256: localHash,
      remoteSha256: remoteHash,
    });
  }

  for (const remoteScript of remote.scripts || []) {
    const remoteKeys = [
      remoteScript.name,
      remoteScript.remoteName,
      remoteScript.homeyScriptId,
    ].filter(Boolean);
    const isExpected = remoteKeys.some(key => expectedKeys.has(key));
    if (!isExpected) {
      results.push({
        name: remoteScript.name,
        remoteName: remoteScript.remoteName ?? remoteScript.name,
        status: 'EXTRA',
        homeyScriptId: remoteScript.homeyScriptId ?? null,
        remoteSha256: remoteScript.sha256 || sha256Text(remoteScript.content || ''),
      });
    }
  }

  return {
    status: results.every(result => result.status === 'OK') ? 'OK' : 'DRIFT',
    generatedAt: new Date().toISOString(),
    results,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    printHelp();
    return;
  }

  const mapping = await readJson(args.mapping);
  let output;

  if (args.command === 'expected') {
    output = await buildExpectedManifest(mapping);
  } else if (args.command === 'verify') {
    output = await verify(mapping, args.remoteFile);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }

  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.out) {
    await writeFile(args.out, json);
    console.log(`Written ${path.relative(ROOT, args.out)}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
