jest.mock('vscode', () => ({
  window: {
    createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), show: jest.fn(), dispose: jest.fn() })),
  },
}), { virtual: true });
import { addressMatchesActor } from '../src/TelegraphPanel';

describe('TelegraphPanel address matching', () => {
  it('does not match wires for other TM aliases just because role is TM', () => {
    expect(addressMatchesActor('TM[wildwest-framework]', 'wildwest-vscode', 'TM(wildwest-vscode)')).toBe(false);
  });

  it('matches exact TM alias in brackets', () => {
    expect(addressMatchesActor('TM[wildwest-vscode]', 'wildwest-vscode', 'TM(wildwest-vscode)')).toBe(true);
  });

  it('matches exact TM identity with parentheses', () => {
    expect(addressMatchesActor('TM(wildwest-vscode)', 'wildwest-vscode', 'TM(wildwest-vscode)')).toBe(true);
  });

  it('matches wildcard alias patterns for suffix matching', () => {
    expect(addressMatchesActor('TM(*vscode)', 'wildwest-vscode', 'TM(wildwest-vscode)')).toBe(true);
    expect(addressMatchesActor('TM[*vscode]', 'wildwest-vscode', 'TM(wildwest-vscode)')).toBe(true);
  });
});
