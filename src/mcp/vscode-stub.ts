// Minimal vscode stub for standalone (no-VSCode) builds.
// Only stubs what TelegraphService.ts and HeartbeatMonitor.ts reference at module level.
export const workspace = {
  workspaceFolders: [] as { uri: { fsPath: string } }[],
  getConfiguration: (_section?: string) => ({
    get: (_key: string, defaultValue?: unknown) => defaultValue,
  }),
};
export const window = {
  showWarningMessage: (_msg: string) => Promise.resolve(undefined),
  showErrorMessage: (_msg: string) => Promise.resolve(undefined),
  createOutputChannel: (_name: string) => ({ appendLine: (_msg: string) => {} }),
};
export const Uri = {
  file: (p: string) => ({ fsPath: p }),
};
export const EventEmitter = class {
  event = (_listener: unknown) => ({ dispose: () => {} });
  fire(_data: unknown) {}
  dispose() {}
};
