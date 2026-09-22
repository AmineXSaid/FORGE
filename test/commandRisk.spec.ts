/**
 * A3: the command risk classifier.
 *
 * Ported from alphacode's `command_risk`, which was written after a real
 * incident where a user lost their home directory. The bypass cases are
 * therefore the most important tests in this file: a classifier that catches
 * `rm -rf ~` but not `sudo rm -rf ~`, `sh -c "rm -rf ~"` or
 * `true && rm -rf ~` is not a safety feature, it is a speed bump.
 *
 * The other half is not being annoying. A classifier that flags ordinary work
 * gets ignored, and an ignored classifier protects nothing — so the negative
 * tests (`rm build/tmp.o`, `cmd > /dev/null`, `rm ~/.config/app/stale.toml`)
 * carry as much weight as the positive ones.
 */
import { describe, expect, it } from 'vitest';
import {
  RiskLevel,
  assess,
  basename,
  classifyTarget,
  gate,
  isCatastrophicTarget,
  isRecursiveFlag,
  scanForShellUrlIssues,
  splitSegments,
  tokenize,
} from '../src/services/claude/commandRisk';

const HOME = '/home/dev';
const CWD = '/home/dev/projects/forge';
const ctx = { homeDirectory: HOME, workingDirectory: CWD };

const levelOf = (command: string) => assess(command, ctx).level;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

describe('tokenize: enough shell to find the targets', () => {
  it('resolves quotes so the target text is the same either way', () => {
    expect(tokenize(`rm "$HOME"`).map((t) => t.text)).toEqual(['rm', '$HOME']);
    expect(tokenize(`rm '/a b/c'`).map((t) => t.text)).toEqual(['rm', '/a b/c']);
  });

  it('keeps $VAR intact rather than guessing at its value', () => {
    // Guessing would be worse than admitting the value is unknown.
    expect(tokenize('rm -rf $TARGET').map((t) => t.text)).toContain('$TARGET');
  });

  it('marks a truncating redirect but not an appending one', () => {
    expect(tokenize('echo x > f').find((t) => t.isTruncatingRedirectTarget)?.text).toBe('f');
    expect(tokenize('echo x >> f').some((t) => t.isTruncatingRedirectTarget)).toBe(false);
  });

  it('handles >| as truncating', () => {
    expect(tokenize('echo x >| f').find((t) => t.isTruncatingRedirectTarget)?.text).toBe('f');
  });

  it('strips the directory from a program name', () => {
    expect(basename(tokenize('/bin/rm -rf x')[0])).toBe('rm');
  });

  it.each([['-rf', true], ['-R', true], ['--recursive', true], ['-f', false], ['--force', false]])(
    'reads %s as recursive: %s',
    (flag, expected) => {
      expect(isRecursiveFlag({ text: flag, receivesPipe: false, isTruncatingRedirectTarget: false, isOperator: false }))
        .toBe(expected);
    },
  );
});

describe('splitSegments: chaining must not be a bypass', () => {
  it.each(['&&', '||', ';', '|'])('splits on %s', (sep) => {
    expect(splitSegments(`ls ${sep} rm -rf /`)).toHaveLength(2);
  });

  it('marks the segment after a pipe as receiving it', () => {
    const [, second] = splitSegments('cat f | xargs rm');
    expect(second[0].receivesPipe).toBe(true);
  });

  it('does not mark the segment after && as piped', () => {
    const [, second] = splitSegments('ls && rm x');
    expect(second[0].receivesPipe).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

describe('isCatastrophicTarget', () => {
  it.each(['/', '/etc', '/usr', '/System', '/home', '/Users', '/var'])(
    'protects the system path %s',
    (p) => expect(isCatastrophicTarget(p, ctx)).toBe(true),
  );

  it('protects files inside roots whose contents are as critical as the root', () => {
    expect(isCatastrophicTarget('/etc/passwd', ctx)).toBe(true);
    expect(isCatastrophicTarget('/usr/bin/env', ctx)).toBe(true);
  });

  it('protects the home directory itself', () => {
    expect(isCatastrophicTarget(HOME, ctx)).toBe(true);
  });

  it.each(['.ssh', '.gnupg', '.aws', '.kube', '.docker'])(
    'protects the credential store ~/%s recursively',
    (dir) => {
      expect(isCatastrophicTarget(`${HOME}/${dir}`, ctx)).toBe(true);
      expect(isCatastrophicTarget(`${HOME}/${dir}/id_rsa`, ctx)).toBe(true);
    },
  );

  it('protects ~/.config as a directory but not the files in it', () => {
    // Deleting individual config files is something people do all day, and
    // protecting every one would make the classifier noisy enough to ignore.
    expect(isCatastrophicTarget(`${HOME}/.config`, ctx)).toBe(true);
    expect(isCatastrophicTarget(`${HOME}/.config/app/stale.toml`, ctx)).toBe(false);
  });

  it('does not protect /home recursively, because projects live under it', () => {
    expect(isCatastrophicTarget('/home', ctx)).toBe(true);
    expect(isCatastrophicTarget('/home/dev/projects/forge/build', ctx)).toBe(false);
  });

  it.each(['/dev/null', '/dev/stdout', '/dev/stderr'])(
    'exempts the device sink %s before the recursive /dev rule',
    (sink) => expect(isCatastrophicTarget(sink, ctx)).toBe(false),
  );

  it('still protects the rest of /dev', () => {
    expect(isCatastrophicTarget('/dev/sda', ctx)).toBe(true);
  });
});

describe('classifyTarget', () => {
  it('treats a file inside the working directory as bounded', () => {
    expect(classifyTarget('build/tmp.o', ctx)).toBe('bounded');
    expect(classifyTarget(`${CWD}/dist`, ctx)).toBe('bounded');
  });

  it('treats the working directory itself as not bounded', () => {
    // Wiping the whole project is a different act from deleting a file in it.
    expect(classifyTarget(CWD, ctx)).toBe('outside');
  });

  it('treats temp directories as bounded', () => {
    expect(classifyTarget('/tmp/scratch', ctx)).toBe('bounded');
  });

  it('treats an unresolvable variable as unknown, not as safe', () => {
    expect(classifyTarget('$TARGET', ctx)).toBe('unknown');
  });

  it('resolves $HOME, because that one actually matters', () => {
    expect(classifyTarget('$HOME', ctx)).toBe('catastrophic');
    expect(classifyTarget('${HOME}', ctx)).toBe('catastrophic');
  });

  it('expands ~', () => {
    expect(classifyTarget('~', ctx)).toBe('catastrophic');
    expect(classifyTarget('~/.ssh', ctx)).toBe('catastrophic');
  });

  it('catches a wildcard directly under a protected root', () => {
    // The `rm -rf /*` shape.
    expect(classifyTarget('/*', ctx)).toBe('catastrophic');
    expect(classifyTarget(`${HOME}/*`, ctx)).toBe('catastrophic');
  });
});

// ---------------------------------------------------------------------------
// Assessment: the bypasses
// ---------------------------------------------------------------------------

describe('the catastrophic cases, and every way around them', () => {
  it('flags the plain form', () => {
    expect(levelOf('rm -rf ~')).toBe(RiskLevel.Catastrophic);
    expect(levelOf('rm -rf /')).toBe(RiskLevel.Catastrophic);
    expect(levelOf('rm -rf $HOME')).toBe(RiskLevel.Catastrophic);
  });

  it.each([
    'sudo rm -rf ~',
    'doas rm -rf ~',
    'env rm -rf ~',
    'nohup rm -rf ~',
    'timeout 5 rm -rf ~',
    'nice -n 10 rm -rf ~',
    'sudo env FOO=bar rm -rf ~',
  ])('sees through the wrapper in: %s', (command) => {
    // Without unwrapping, any common prefix is a complete bypass.
    expect(levelOf(command)).toBe(RiskLevel.Catastrophic);
  });

  it.each([
    `sh -c "rm -rf ~"`,
    `bash -c 'rm -rf /etc'`,
    `sudo sh -c "rm -rf ~"`,
  ])('assesses the inline script in: %s', (command) => {
    expect(levelOf(command)).toBe(RiskLevel.Catastrophic);
  });

  it.each([
    'ls && rm -rf ~',
    'ls ; rm -rf ~',
    'false || rm -rf ~',
    'echo hi && echo there && rm -rf ~',
  ])('assesses every segment in: %s', (command) => {
    expect(levelOf(command)).toBe(RiskLevel.Catastrophic);
  });

  it('flags a truncating redirect onto a protected file', () => {
    // No destructive verb anywhere in this command.
    expect(levelOf('echo "" > /etc/passwd')).toBe(RiskLevel.Catastrophic);
  });

  it('flags destruction of a credential store', () => {
    expect(levelOf('rm -rf ~/.ssh')).toBe(RiskLevel.Catastrophic);
    expect(levelOf('shred ~/.aws/credentials')).toBe(RiskLevel.Catastrophic);
  });

  it('flags a wrapper whose payload it cannot read, rather than assuming safety', () => {
    const assessment = assess('sudo', ctx);
    expect(assessment.level).toBe(RiskLevel.Confirm);
    expect(assessment.findings[0].reason).toMatch(/could not be identified/);
  });
});

describe('ordinary work is not flagged', () => {
  it.each([
    'ls -la',
    'git status',
    'npm install',
    'cat package.json',
    'echo hello',
    'grep -r TODO src',
  ])('leaves %s alone', (command) => {
    expect(levelOf(command)).toBe(RiskLevel.Safe);
  });

  it('allows the standard device sinks', () => {
    expect(levelOf('make build > /dev/null')).toBe(RiskLevel.Safe);
    expect(levelOf('noisy 2> /dev/null')).toBe(RiskLevel.Safe);
  });

  it('treats deleting inside the working directory as low, not a prompt-stopper', () => {
    expect(levelOf('rm -rf build')).toBe(RiskLevel.Low);
    expect(levelOf('rm dist/bundle.js')).toBe(RiskLevel.Low);
  });

  it('allows deleting an individual file under a protected config root', () => {
    expect(levelOf(`rm ${HOME}/.config/app/stale.toml`)).toBe(RiskLevel.Confirm);
    expect(levelOf(`rm ${HOME}/.config/app/stale.toml`)).not.toBe(RiskLevel.Catastrophic);
  });

  it('does not flag an appending redirect', () => {
    expect(levelOf('echo line >> /etc/hosts')).toBe(RiskLevel.Safe);
  });
});

describe('the middle ground', () => {
  it('asks about deleting outside the working directory', () => {
    expect(levelOf('rm -rf /home/dev/other-project')).toBe(RiskLevel.Confirm);
  });

  it('asks when the target is decided at runtime', () => {
    const assessment = assess('rm -rf $TARGET', ctx);
    expect(assessment.level).toBe(RiskLevel.Confirm);
    expect(assessment.findings[0].reason).toMatch(/set at runtime/);
  });

  it('asks when targets arrive through a pipe', () => {
    const assessment = assess('find . -name "*.o" | xargs rm', ctx);
    expect(assessment.level).toBeGreaterThanOrEqual(RiskLevel.Confirm);
  });

  it.each([
    'find . -delete',
    'git clean -fdx',
    'chmod -R 777 /home/dev/other',
  ])('flags the conditionally destructive: %s', (command) => {
    expect(levelOf(command)).toBeGreaterThan(RiskLevel.Safe);
  });

  it('does not flag the same programs without their destructive flags', () => {
    expect(levelOf('find . -name "*.ts"')).toBe(RiskLevel.Safe);
    expect(levelOf('git status')).toBe(RiskLevel.Safe);
  });
});

describe('curl | sh', () => {
  it('flags download-and-execute', () => {
    const assessment = assess('curl https://example.com/install.sh | sh', ctx);
    expect(assessment.level).toBe(RiskLevel.Confirm);
    expect(assessment.findings[0].reason).toMatch(/before anyone can read it/);
  });

  it.each(['sh', 'bash', 'python3', 'node', 'perl'])('flags a pipe into %s', (shell) => {
    expect(scanForShellUrlIssues(`curl https://x/i.sh | ${shell}`)).toHaveLength(1);
  });

  it.each(['curl', 'wget', 'aria2c'])('flags %s as the downloader', (tool) => {
    expect(scanForShellUrlIssues(`${tool} https://x/i.sh | sh`)).toHaveLength(1);
  });

  it('does not flag a download that is merely saved', () => {
    expect(scanForShellUrlIssues('curl -o install.sh https://example.com/install.sh')).toEqual([]);
  });

  it('does not flag a pipe into something that is not an interpreter', () => {
    expect(scanForShellUrlIssues('curl https://x/data | jq .')).toEqual([]);
  });

  it('reports the URL so the dialog can show it', () => {
    expect(scanForShellUrlIssues('curl -fsSL https://get.example.com/x.sh | bash')[0].url)
      .toBe('https://get.example.com/x.sh');
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('gate: assessment and decision are separate on purpose', () => {
  it('allows a safe command outright', () => {
    expect(gate({ assessment: assess('ls', ctx) })).toEqual({ decision: 'allow' });
  });

  it('asks about an irreversible command and pre-selects deny', () => {
    const outcome = gate({ assessment: assess('rm -rf /home/dev/other', ctx) });
    expect(outcome.decision).toBe('ask');
    expect(outcome.suggestedDefault).toBe('deny');
    expect(outcome.reason).toMatch(/outside the working directory/);
  });

  it('asks about a bounded delete but pre-selects allow', () => {
    const outcome = gate({ assessment: assess('rm -rf build', ctx) });
    expect(outcome.decision).toBe('ask');
    expect(outcome.suggestedDefault).toBe('allow');
  });

  describe('risk is advisory: an explicit rule wins', () => {
    it('honours a user rule over a Confirm assessment', () => {
      // The user knows something the classifier does not.
      const outcome = gate({
        assessment: assess('rm -rf /home/dev/other', ctx),
        explicitlyAllowed: true,
      });
      expect(outcome.decision).toBe('allow');
    });

    it('does not let a rule unlock a catastrophic command', () => {
      // The cost of being overruled and right here is unbounded; the cost of a
      // false positive is rephrasing one command.
      const outcome = gate({
        assessment: assess('rm -rf ~', ctx),
        explicitlyAllowed: true,
      });
      expect(outcome.decision).toBe('deny');
    });
  });

  describe('bypassPermissions', () => {
    it('does not block, because the user turned prompts off deliberately', () => {
      const outcome = gate({
        assessment: assess('rm -rf /home/dev/other', ctx),
        bypassPermissions: true,
      });
      expect(outcome.decision).toBe('allow');
    });

    it('still computes the assessment, so it can be logged', () => {
      const outcome = gate({
        assessment: assess('rm -rf /home/dev/other', ctx),
        bypassPermissions: true,
      });
      expect(outcome.reason).toMatch(/outside the working directory/);
    });

    it('still refuses a catastrophic command', () => {
      const outcome = gate({ assessment: assess('rm -rf ~', ctx), bypassPermissions: true });
      expect(outcome.decision).toBe('deny');
    });

    it('says nothing about a safe command', () => {
      expect(gate({ assessment: assess('ls', ctx), bypassPermissions: true }).reason).toBeUndefined();
    });
  });
});

describe('the explanation names the target, so the dialog can show why', () => {
  it('quotes the path that triggered it', () => {
    const outcome = gate({ assessment: assess('rm -rf ~/.ssh', ctx) });
    expect(outcome.reason).toMatch(/~\/\.ssh/);
    expect(outcome.reason).toMatch(/protected location/);
  });

  it('lists every finding when a command has several', () => {
    const assessment = assess('rm -rf ~ && rm -rf /etc', ctx);
    expect(assessment.findings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('no working directory configured', () => {
  it('still protects absolute system paths', () => {
    expect(assess('rm -rf /etc', {}).level).toBe(RiskLevel.Catastrophic);
  });

  it('does not crash on a relative target', () => {
    expect(() => assess('rm -rf build', {})).not.toThrow();
  });

  it('does not claim home knowledge it does not have', () => {
    expect(assess('rm -rf ~', {}).level).not.toBe(RiskLevel.Catastrophic);
  });
});

describe('degenerate input', () => {
  it.each(['', '   ', '\n', '|', '&&', '>'])('does not throw on %j', (command) => {
    expect(() => assess(command, ctx)).not.toThrow();
  });

  it('reports an empty command as safe', () => {
    expect(assess('', ctx).level).toBe(RiskLevel.Safe);
  });
});
