#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS_FILE = path.join(ROOT, 'release', 'components.json');

function parseArgs(argv) {
  const args = {
    outDir: 'dist/releases',
    includeEsp32Artifact: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--system-release') args.systemRelease = argv[++i];
    else if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--esp32-bin') args.esp32Bin = argv[++i];
    else if (arg === '--homey-app-artifact') args.homeyAppArtifact = argv[++i];
    else if (arg === '--homey-app-v2-artifact') args.homeyAppV2Artifact = argv[++i];
    else if (arg === '--homey-scripts-artifact') args.homeyScriptsArtifact = argv[++i];
    else if (arg === '--no-esp32-artifact') args.includeEsp32Artifact = false;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node tools/release/prepare-release.mjs --system-release v1.0.0 [options]

Options:
  --out-dir <dir>                 Output directory. Default: dist/releases
  --esp32-bin <file>              ESP32 OTA binary to copy into the release.
                                  Defaults to the path declared in release/components.json.
  --no-esp32-artifact             Do not copy an ESP32 binary; only hash sources.
  --homey-app-artifact <file>     Homey app package/zip to copy into the release.
  --homey-app-v2-artifact <file>  Homey app v2 package to copy into the release.
  --homey-scripts-artifact <file> HomeyScripts package/zip to copy into the release.
`);
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

async function sha256(file) {
  const data = await readFile(file);
  return createHash('sha256').update(data).digest('hex');
}

async function listFiles(target) {
  const full = path.resolve(ROOT, target);
  if (!existsSync(full)) return [];

  const info = await stat(full);
  if (info.isFile()) return [target];

  const entries = await readdir(full, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.homeybuild' || entry.name === '.esphome') {
      continue;
    }
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

function artifactName(pattern, version) {
  return pattern.replaceAll('{version}', version);
}

function parseVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Unsupported version format: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function satisfiesComparator(version, comparator) {
  const match = comparator.match(/^(>=|>|<=|<|=)?(\d+\.\d+\.\d+)$/);
  if (!match) throw new Error(`Unsupported range comparator: ${comparator}`);

  const operator = match[1] || '=';
  const expected = match[2];
  const comparison = compareVersions(version, expected);

  if (operator === '>=') return comparison >= 0;
  if (operator === '>') return comparison > 0;
  if (operator === '<=') return comparison <= 0;
  if (operator === '<') return comparison < 0;
  return comparison === 0;
}

function satisfiesRange(version, range) {
  return String(range)
    .split(/\s+/)
    .filter(Boolean)
    .every(comparator => satisfiesComparator(version, comparator));
}

function checkContracts(components) {
  const providedByName = new Map();
  for (const [componentKey, component] of Object.entries(components)) {
    for (const contract of Object.values(component.provides || {})) {
      providedByName.set(contract.name, {
        ...contract,
        component: componentKey,
      });
    }
  }

  const issues = [];
  for (const [componentKey, component] of Object.entries(components)) {
    for (const [requirementKey, requirement] of Object.entries(component.requires || {})) {
      const provided = providedByName.get(requirement.name);
      if (!provided) {
        issues.push({
          level: 'ERROR',
          component: componentKey,
          requirement: requirementKey,
          reason: 'MISSING_CONTRACT',
          expectedName: requirement.name,
        });
        continue;
      }

      if (!satisfiesRange(provided.version, requirement.range)) {
        issues.push({
          level: 'ERROR',
          component: componentKey,
          requirement: requirementKey,
          reason: 'VERSION_OUT_OF_RANGE',
          expectedName: requirement.name,
          expectedRange: requirement.range,
          actualVersion: provided.version,
          provider: provided.component,
        });
      }
    }
  }

  return {
    status: issues.some(issue => issue.level === 'ERROR') ? 'ERROR' : 'OK',
    issues,
  };
}

async function copyArtifact({ source, targetDir, targetName }) {
  if (!source) return null;
  const absoluteSource = path.resolve(ROOT, source);
  if (!existsSync(absoluteSource)) return null;

  const target = path.join(targetDir, targetName);
  await copyFile(absoluteSource, target);
  return {
    file: path.relative(ROOT, target),
    sha256: await sha256(target),
  };
}

async function hashSources(component) {
  const sourceFiles = [];
  for (const sourcePath of component.sourcePaths || []) {
    sourceFiles.push(...await listFiles(sourcePath));
  }

  const uniqueFiles = [...new Set(sourceFiles)].sort();
  const hashes = {};
  for (const file of uniqueFiles) {
    hashes[file] = await sha256(path.join(ROOT, file));
  }

  return hashes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.systemRelease) {
    throw new Error('Missing required --system-release');
  }

  const componentsConfig = JSON.parse(await readFile(COMPONENTS_FILE, 'utf8'));
  const outDir = path.resolve(ROOT, args.outDir, args.systemRelease);
  await mkdir(outDir, { recursive: true });

  const gitCommit = gitValue(['rev-parse', 'HEAD']);
  const dirtyFiles = gitValue(['status', '--short'], '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const components = {};
  for (const [key, component] of Object.entries(componentsConfig.components)) {
    components[key] = {
      id: component.id,
      version: component.version,
      provides: component.provides || {},
      requires: component.requires || {},
      sourceSha256: await hashSources(component),
    };
  }

  if (args.includeEsp32Artifact) {
    const esp32 = componentsConfig.components.esp32Firmware;
    const esp32Source = args.esp32Bin || esp32.defaultBuildArtifact;
    const copied = await copyArtifact({
      source: esp32Source,
      targetDir: outDir,
      targetName: artifactName(esp32.artifactPattern, esp32.version),
    });
    if (copied) components.esp32Firmware.artifact = copied;
  }

  if (args.homeyAppArtifact) {
    const homeyApp = componentsConfig.components.homeyApp;
    const copied = await copyArtifact({
      source: args.homeyAppArtifact,
      targetDir: outDir,
      targetName: artifactName(homeyApp.artifactPattern, homeyApp.version),
    });
    if (copied) components.homeyApp.artifact = copied;
  }

  if (args.homeyAppV2Artifact) {
    const homeyAppV2 = componentsConfig.components.homeyAppV2;
    const copied = await copyArtifact({
      source: args.homeyAppV2Artifact,
      targetDir: outDir,
      targetName: artifactName(homeyAppV2.artifactPattern, homeyAppV2.version),
    });
    if (copied) components.homeyAppV2.artifact = copied;
  }

  if (args.homeyScriptsArtifact) {
    const homeyScripts = componentsConfig.components.homeyScripts;
    const copied = await copyArtifact({
      source: args.homeyScriptsArtifact,
      targetDir: outDir,
      targetName: artifactName(homeyScripts.artifactPattern, homeyScripts.version),
    });
    if (copied) components.homeyScripts.artifact = copied;
  }

  const manifest = {
    schemaVersion: 1,
    systemRelease: args.systemRelease,
    generatedAt: new Date().toISOString(),
    git: {
      commit: gitCommit,
      dirty: dirtyFiles.length > 0,
      dirtyFiles,
    },
    components,
    compatibility: checkContracts(components),
    compatibilityPolicy: componentsConfig.compatibilityPolicy,
  };

  const manifestFile = path.join(outDir, 'release-manifest.json');
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  const checksumLines = [];
  const releaseFiles = (await listFiles(path.relative(ROOT, outDir)))
    .filter(file => !file.endsWith('/SHA256SUMS.txt'));
  for (const file of releaseFiles) {
    checksumLines.push(`${await sha256(path.join(ROOT, file))}  ${file}`);
  }
  await writeFile(path.join(outDir, 'SHA256SUMS.txt'), `${checksumLines.sort().join('\n')}\n`);

  console.log(`Release manifest generated: ${path.relative(ROOT, manifestFile)}`);
  console.log(`Checksums generated: ${path.relative(ROOT, path.join(outDir, 'SHA256SUMS.txt'))}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
