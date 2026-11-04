import { runLine, runScript, type ShellResult } from './shell';
import { World } from './world';

export class SetupError extends Error {}

/**
 * Git sandbox: a model of repositories, working trees and remotes that lives in memory. It never reaches
 * the real file system, a network or an installed git; commands only change this model.
 */
export class GitSandboxEngine {
  readonly kind = 'git' as const;
  world: World;

  constructor(private readonly identity?: { name: string; email: string }) {
    this.world = new World(identity);
  }

  /** Starts from an empty home directory and runs the setup script; a failing setup is a content bug. */
  reset(setup: string): void {
    this.world = new World(this.identity);
    const result = runScript(this.world, setup);
    if (result.failed) {
      const output = result.lines.map((l) => l.text).join('\n');
      throw new SetupError(`setup failed at «${result.failed.line}» (exit ${result.failed.exit}):\n${output}`);
    }
  }

  run(line: string): ShellResult {
    return runLine(this.world, line);
  }

  /** Runs a multi-line script, e.g. a reference solution. */
  runScript(script: string) {
    return runScript(this.world, script);
  }
}
