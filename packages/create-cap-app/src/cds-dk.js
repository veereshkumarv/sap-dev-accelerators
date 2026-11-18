/**
 * What: Runs SAP's CAP CLI (@sap/cds-dk) and npm as child processes without a shell, with
 *     timeouts and captured output.
 * Why: The generator wraps SAP-maintained scaffolding (cds init / cds add / cds compile) instead
 *     of copying it, so SAP keeps owning those parts; no shell means no command injection via
 *     project names.
 * If missing or unlinked: create-cap-app cannot call cds init / cds add / cds compile or npm
 *     install, and generation fails at the first step.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const TIMEOUT_MS = 180_000;

export class CommandError extends Error {
  /**
   * @param {string} message
   * @param {string} output
   */
  constructor(message, output) {
    super(`${message}\n${output.trim()}`);
    this.name = 'CommandError';
    this.output = output;
  }
}

/** Absolute path of the cds CLI shipped with the installed @sap/cds-dk. */
export function cdsBin() {
  return path.join(path.dirname(require.resolve('@sap/cds-dk/package.json')), 'bin', 'cds.js');
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd: string, timeout?: number }} options
 * @returns {Promise<string>} stdout
 */
export function run(file, args, { cwd, timeout = TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd, timeout, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
      (err, stdout, stderr) => {
        if (err) reject(new CommandError(`Command failed: ${path.basename(file)} ${args.join(' ')}`, `${stdout}\n${stderr}`));
        else resolve(stdout);
      },
    );
  });
}

/**
 * @param {string[]} args  e.g. ['init', 'name', '--add', 'nodejs,hana']
 * @param {string} cwd
 */
export function cds(args, cwd) {
  return run(process.execPath, [cdsBin(), ...args], { cwd });
}

/**
 * npm resolved next to the running Node binary (same installation), falling back to PATH.
 * @param {string[]} args
 * @param {string} cwd
 */
export function npm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && npmCli.endsWith('.js')) return run(process.execPath, [npmCli, ...args], { cwd, timeout: 600_000 });
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, timeout: 600_000 });
}
