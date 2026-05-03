import { describe, it, expect, vi } from 'vitest';
import { findExistingMoltbotProcess, ensureMoltbotGateway } from './process';
import type { Sandbox, Process } from '@cloudflare/sandbox';
import { createMockEnv, createMockSandbox, suppressConsole } from '../test-utils';

function createFullMockProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: 'test-id',
    command: 'openclaw gateway',
    status: 'running',
    startTime: new Date(),
    endTime: undefined,
    exitCode: undefined,
    waitForPort: vi.fn(),
    waitForExit: vi.fn(),
    kill: vi.fn(),
    getStatus: vi.fn().mockResolvedValue(overrides.status ?? 'running'),
    getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    ...overrides,
  } as Process;
}

describe('findExistingMoltbotProcess', () => {
  it('returns null when no processes exist', async () => {
    const { sandbox } = createMockSandbox({ processes: [] });
    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns null when only CLI commands are running', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw devices list --json', status: 'running' }),
      createFullMockProcess({ command: 'openclaw --version', status: 'completed' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns gateway process when running (openclaw)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: 'openclaw gateway --port 18789',
      status: 'running',
    });
    const processes = [
      createFullMockProcess({ command: 'openclaw devices list', status: 'completed' }),
      gatewayProcess,
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('returns gateway process when starting via startup script', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'starting',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('matches legacy clawdbot gateway command (transition compat)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: 'clawdbot gateway --port 18789',
      status: 'running',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('matches legacy start-moltbot.sh command (transition compat)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-moltbot.sh',
      status: 'running',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('ignores completed gateway processes', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw gateway', status: 'completed' }),
      createFullMockProcess({ command: 'start-openclaw.sh', status: 'failed' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBeNull();
  });

  it('handles listProcesses errors gracefully', async () => {
    const sandbox = {
      listProcesses: vi.fn().mockRejectedValue(new Error('Network error')),
    } as unknown as Sandbox;

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns first matching gateway process', async () => {
    const firstGateway = createFullMockProcess({
      id: 'gateway-1',
      command: 'openclaw gateway',
      status: 'running',
    });
    const secondGateway = createFullMockProcess({
      id: 'gateway-2',
      command: 'start-openclaw.sh',
      status: 'starting',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([firstGateway, secondGateway]);

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result?.id).toBe('gateway-1');
  });

  it('does not match openclaw onboard as a gateway process', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw onboard --non-interactive', status: 'running' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingMoltbotProcess(sandbox);
    expect(result).toBeNull();
  });
});

describe('ensureMoltbotGateway', () => {
  it('includes startup logs when waiting for the gateway port times out', async () => {
    suppressConsole();

    const process = createFullMockProcess({
      id: 'new-gateway',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'starting',
      waitForPort: vi.fn().mockRejectedValue(new Error('port timeout')),
      getLogs: vi.fn().mockResolvedValue({
        stdout: 'Config directory: /root/.openclaw',
        stderr: 'Invalid config: gateway.mode is required',
      }),
    });
    const { sandbox, startProcessMock } = createMockSandbox({ processes: [] });
    startProcessMock.mockResolvedValue(process);

    await expect(ensureMoltbotGateway(sandbox, createMockEnv())).rejects.toThrow(
      /Invalid config: gateway\.mode is required/,
    );
  });

  it('falls back to the startup log file when process logs are empty', async () => {
    suppressConsole();

    const process = createFullMockProcess({
      id: 'new-gateway',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'starting',
      waitForPort: vi.fn().mockRejectedValue(new Error('port timeout')),
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    });
    const { sandbox, startProcessMock, execMock } = createMockSandbox({ processes: [] });
    startProcessMock.mockResolvedValue(process);
    execMock.mockResolvedValue({
      stdout: 'Config directory: /root/.openclaw\nOnboard completed',
      stderr: '',
      exitCode: 0,
      success: true,
      command: '',
      duration: 0,
      timestamp: new Date().toISOString(),
    });

    await expect(ensureMoltbotGateway(sandbox, createMockEnv())).rejects.toThrow(
      /Startup log: Config directory: \/root\/.openclaw\nOnboard completed/,
    );
  });
});
