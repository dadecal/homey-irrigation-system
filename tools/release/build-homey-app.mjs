#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_APP_DIR = path.join(ROOT, 'homey', 'app');
const COMPONENTS_FILE = path.join(ROOT, 'release', 'components.json');
const require = createRequire(import.meta.url);
const HomeyCliApp = require(path.join(DEFAULT_APP_DIR, 'node_modules', 'homey', 'lib', 'App.js'));

function parseArgs(argv) {
  const args = {
    outDir: 'dist/artifacts/homey-app',
    component: 'homeyApp',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--component') args.component = argv[++i];
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
  --component <name>   Component key from release/components.json.
                       Supported: homeyApp, homeyAppV2. Default: homeyApp
  --skip-validate      Do not run npm run validate.
  --skip-tests         Do not run npm test.

The script always runs 'npx homey app build' and packages the generated
the selected app's .homeybuild directory with the same tar.gz packer used by the Homey
CLI installer. The resulting .tgz is the deployable release artifact.
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
  const component = components.components[args.component];
  if (!component) {
    throw new Error(`Unknown Homey app component: ${args.component}`);
  }

  if (!Array.isArray(component.sourcePaths) || component.sourcePaths.length !== 1) {
    throw new Error(`Component ${args.component} must declare exactly one sourcePath`);
  }

  const appDir = path.join(ROOT, component.sourcePaths[0]);
  const packageJson = await readJson(path.join(appDir, 'package.json'));
  const appJson = await readJson(path.join(appDir, 'app.json'));

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
    run('npm', ['run', 'validate'], appDir);
  }

  if (!args.skipTests) {
    run('npm', ['test'], appDir);
  }

  run('npx', ['homey', 'app', 'build'], appDir);

  const outDir = path.resolve(ROOT, args.outDir);
  await mkdir(outDir, { recursive: true });

  const targetName = artifactName(component.artifactPattern, component.version);
  const target = path.join(outDir, targetName);
  await rm(target, { force: true });

  const app = new HomeyCliApp(appDir);
  const packStream = await app._getPackStream();
  await pipeline(packStream, createWriteStream(target));

  console.log(`Homey app artifact generated: ${path.relative(ROOT, target)}`);
  console.log(`SHA256: ${await sha256(target)}`);
  console.log(`To deploy this exact artifact, run: node tools/release/install-homey-app-artifact.mjs --artifact ${path.relative(ROOT, target)} --app-dir ${component.sourcePaths[0]}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
