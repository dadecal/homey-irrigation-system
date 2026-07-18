#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS_FILE = path.join(ROOT, 'release', 'components.json');
const HOMEY_SCRIPTS_FILE = path.join(ROOT, 'release', 'homey-scripts.json');

function parseArgs(argv) {
  const args = {
    outDir: 'dist/artifacts/homey-scripts',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--skip-syntax-check') args.skipSyntaxCheck = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node tools/release/build-homey-scripts.mjs [options]

Options:
  --out-dir <dir>          Output directory. Default: dist/artifacts/homey-scripts
  --skip-syntax-check      Do not run node -c over the script files.

The artifact contains every script declared in release/components.json plus an
internal homey-scripts-manifest.json with versions, contracts and SHA256 hashes.
`);
}

function run(command, args, cwd = ROOT) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function sha256(file) {
  const data = await readFile(file);
  return createHash('sha256').update(data).digest('hex');
}

function artifactName(pattern, version) {
  return pattern.replaceAll('{version}', version);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const components = await readJson(COMPONENTS_FILE);
  const homeyScripts = await readJson(HOMEY_SCRIPTS_FILE);
  const component = components.components.homeyScripts;
  if (!component?.artifactPattern) {
    throw new Error('Missing homeyScripts.artifactPattern in release/components.json');
  }

  const componentPaths = [...(component.sourcePaths || [])].sort();
  const mappedPaths = [...(homeyScripts.scripts || []).map(script => script.localPath)].sort();
  if (JSON.stringify(componentPaths) !== JSON.stringify(mappedPaths)) {
    throw new Error(
      'HomeyScripts path mismatch between release/components.json and release/homey-scripts.json',
    );
  }

  for (const script of component.sourcePaths || []) {
    const absoluteScript = path.join(ROOT, script);
    if (!existsSync(absoluteScript)) {
      throw new Error(`Missing HomeyScript source: ${script}`);
    }
    if (!args.skipSyntaxCheck) {
      run('node', ['-c', absoluteScript]);
    }
  }

  const outDir = path.resolve(ROOT, args.outDir);
  await mkdir(outDir, { recursive: true });

  const packageDir = await mkdtemp(path.join(os.tmpdir(), 'homey-scripts-artifact-'));
  const scriptsDir = path.join(packageDir, 'scripts');
  await mkdir(scriptsDir, { recursive: true });

  const scriptHashes = {};
  for (const script of component.sourcePaths || []) {
    const absoluteScript = path.join(ROOT, script);
    const scriptName = path.basename(script);
    await copyFile(absoluteScript, path.join(scriptsDir, scriptName));
    scriptHashes[script] = await sha256(absoluteScript);
  }

  const manifest = {
    schemaVersion: 1,
    component: component.id,
    version: component.version,
    generatedAt: new Date().toISOString(),
    provides: component.provides || {},
    requires: component.requires || {},
    scripts: scriptHashes,
  };

  await writeFile(
    path.join(packageDir, 'homey-scripts-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const targetName = artifactName(component.artifactPattern, component.version);
  const target = path.join(outDir, targetName);
  const tmpZip = path.join(packageDir, targetName);
  run('zip', ['-qr', tmpZip, '.'], packageDir);
  await rename(tmpZip, target);
  await rm(packageDir, { recursive: true, force: true });

  console.log(`HomeyScripts artifact generated: ${path.relative(ROOT, target)}`);
  console.log(`SHA256: ${await sha256(target)}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
