import { describe, expect, it } from 'vitest';
import { toHex } from '../src/webview/src/utils/mermaid';

describe('toHex: colours for mermaid lists it splits on commas', () => {
  it('turns rgb() and rgba() into hex', () => {
    expect(toHex('rgb(66, 143, 220)')).toBe('#428fdc');
    expect(toHex('rgba(0, 0, 0, 0.5)')).toBe('#000000');
    expect(toHex('rgb(255 255 255)')).toBe('#ffffff');
  });

  it('leaves anything else alone', () => {
    expect(toHex('#123456')).toBe('#123456');
    expect(toHex('color(srgb 1 0 0)')).toBe('color(srgb 1 0 0)');
  });
});
