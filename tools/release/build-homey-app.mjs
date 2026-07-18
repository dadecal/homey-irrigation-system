#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_DIR = path.join(ROOT, 'homey', 'app');
const COMPONENTS_FILE = path.join(ROOT, 'release', 'components.json');

function parseArgs(argv) {
  const args = {
    outDir: 'dist/artifacts/homey-app',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--skip-tests') args.skipTests = true;
    else if (arg === '--skip-validate') args.skipValidate = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node tools/release/build-homey-app.mjs [options]

Options:
  --out-dir <dir>      Output directory. Default: dist/artifacts/homey-app
  --skip-validate      Do not run npm run validate.
  --skip-tests         Do not run npm test.

The script always runs 'npx homey app build' and packages the generated
homey/app/.homeybuild directory as the release artifact.
`);
}

function run(command, args, cwd = ROOT) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
}

async function sha256(file) {
  const data = await readFile(file);
  return createHash('sha256').update(data).digest('hex');
}

function artifactName(pattern, version) {
  return pattern.replaceAll('{version}', version);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const components = await readJson(COMPONENTS_FILE);
  const packageJson = await readJson(path.join(APP_DIR, 'package.json'));
  const appJson = await readJson(path.join(APP_DIR, 'app.json'));
  const component = components.components.homeyApp;

  if (packageJson.version !== appJson.version) {
    throw new Error(
      `Homey app version mismatch: package.json=${packageJson.version}, app.json=${appJson.version}`,
    );
  }

  if (packageJson.version !== component.version) {
    throw new Error(
      `Homey app version mismatch: release/components.json=${component.version}, package.json=${packageJson.version}`,
    );
  }

  if (!args.skipValidate) {
    run('npm', ['run', 'validate'], APP_DIR);
  }

  if (!args.skipTests) {
    run('npm', ['test'], APP_DIR);
  }

  run('npx', ['homey', 'app', 'build'], APP_DIR);

  const outDir = path.resolve(ROOT, args.outDir);
  await mkdir(outDir, { recursive: true });

  const targetName = artifactName(component.artifactPattern, component.version);
  const target = path.join(outDir, targetName);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'homey-app-artifact-'));
  const tmpZip = path.join(tmpDir, targetName);

  run('zip', ['-qr', tmpZip, '.'], path.join(APP_DIR, '.homeybuild'));
  await rename(tmpZip, target);
  await rm(tmpDir, { recursive: true, force: true });

  console.log(`Homey app artifact generated: ${path.relative(ROOT, target)}`);
  console.log(`SHA256: ${await sha256(target)}`);
  console.log('To deploy this exact build, run from homey/app: npx homey app install --skip-build');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
