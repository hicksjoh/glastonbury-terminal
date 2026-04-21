import { describe, it, expect } from 'vitest';
import { cachedSystem, KEISHA_SYSTEM_PROMPT } from '../prompts';

describe('cachedSystem', () => {
  it('returns a single cached block when no dynamic text is provided', () => {
    const result = cachedSystem('static content');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'text',
      text: 'static content',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('returns a cached block + uncached dynamic block when dynamic text is provided', () => {
    const result = cachedSystem('static content', 'dynamic data');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'text',
      text: 'static content',
      cache_control: { type: 'ephemeral' },
    });
    expect(result[1]).toEqual({
      type: 'text',
      text: 'dynamic data',
    });
    // Verify the dynamic block has no cache_control
    expect(result[1]).not.toHaveProperty('cache_control');
  });

  it('ignores empty dynamic text', () => {
    const result = cachedSystem('static', '');
    expect(result).toHaveLength(1);
  });

  it('ignores undefined dynamic text', () => {
    const result = cachedSystem('static', undefined);
    expect(result).toHaveLength(1);
  });

  it('caches the real KEISHA_SYSTEM_PROMPT (regression guard)', () => {
    const result = cachedSystem(KEISHA_SYSTEM_PROMPT);
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(result[0].text).toBe(KEISHA_SYSTEM_PROMPT);
    expect(result[0].text.length).toBeGreaterThan(10_000);
  });
});
