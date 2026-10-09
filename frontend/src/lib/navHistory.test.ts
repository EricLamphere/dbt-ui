import { describe, expect, it } from 'vitest';
import {
  MAX_NAV_HISTORY,
  createNavHistory,
  recordNavigation,
  stepDelta,
  type NavEntry,
  type NavHistory,
} from './navHistory';

const entry = (key: string, href = `/${key}`): NavEntry => ({ key, href });

function pushAll(start: NavHistory, keys: string[]): NavHistory {
  return keys.reduce((h, k) => recordNavigation(h, 'PUSH', entry(k)), start);
}

describe('createNavHistory', () => {
  it('starts with a single entry and nowhere to go', () => {
    const h = createNavHistory(entry('home', '/'));
    expect(h.entries).toEqual([entry('home', '/')]);
    expect(h.index).toBe(0);
    expect(stepDelta(h, -1)).toBeNull();
    expect(stepDelta(h, 1)).toBeNull();
  });
});

describe('recordNavigation', () => {
  it('PUSH appends and moves to the new entry', () => {
    const h = pushAll(createNavHistory(entry('a')), ['b', 'c']);
    expect(h.entries.map((e) => e.key)).toEqual(['a', 'b', 'c']);
    expect(h.index).toBe(2);
  });

  it('PUSH after going back drops the forward entries', () => {
    let h = pushAll(createNavHistory(entry('a')), ['b', 'c']);
    h = recordNavigation(h, 'POP', entry('a'));
    h = recordNavigation(h, 'PUSH', entry('d'));
    expect(h.entries.map((e) => e.key)).toEqual(['a', 'd']);
    expect(h.index).toBe(1);
  });

  it('PUSH caps history at MAX_NAV_HISTORY, dropping the oldest', () => {
    const keys = Array.from({ length: MAX_NAV_HISTORY + 5 }, (_, i) => `k${i}`);
    const h = pushAll(createNavHistory(entry('start')), keys);
    expect(h.entries).toHaveLength(MAX_NAV_HISTORY);
    expect(h.entries[0].key).toBe(`k${5}`);
    expect(h.index).toBe(MAX_NAV_HISTORY - 1);
  });

  it('REPLACE swaps the current entry without changing length or index', () => {
    let h = pushAll(createNavHistory(entry('a')), ['b', 'c']);
    h = recordNavigation(h, 'POP', entry('b'));
    h = recordNavigation(h, 'REPLACE', entry('b2', '/b?x=1'));
    expect(h.entries.map((e) => e.key)).toEqual(['a', 'b2', 'c']);
    expect(h.index).toBe(1);
  });

  it('POP to a known key moves the index to it', () => {
    let h = pushAll(createNavHistory(entry('a')), ['b', 'c']);
    h = recordNavigation(h, 'POP', entry('a'));
    expect(h.index).toBe(0);
    h = recordNavigation(h, 'POP', entry('c'));
    expect(h.index).toBe(2);
  });

  it('POP to an unknown key resets history to that entry', () => {
    const h = recordNavigation(pushAll(createNavHistory(entry('a')), ['b']), 'POP', entry('zzz'));
    expect(h.entries).toEqual([entry('zzz')]);
    expect(h.index).toBe(0);
  });

  it('ignores a navigation to the entry it is already on', () => {
    const h = pushAll(createNavHistory(entry('a')), ['b']);
    expect(recordNavigation(h, 'PUSH', entry('b'))).toBe(h);
  });

  it('never mutates the previous history', () => {
    const h = pushAll(createNavHistory(entry('a')), ['b']);
    const snapshot = JSON.stringify(h);
    recordNavigation(h, 'PUSH', entry('c'));
    recordNavigation(h, 'REPLACE', entry('c'));
    recordNavigation(h, 'POP', entry('a'));
    expect(JSON.stringify(h)).toBe(snapshot);
  });
});

describe('stepDelta', () => {
  it('returns -1 / +1 for adjacent distinct entries', () => {
    let h = pushAll(createNavHistory(entry('a')), ['b', 'c']);
    h = recordNavigation(h, 'POP', entry('b'));
    expect(stepDelta(h, -1)).toBe(-1);
    expect(stepDelta(h, 1)).toBe(1);
  });

  it('skips over consecutive duplicates of the current URL', () => {
    // e.g. clicking "Project home" while already on project home pushes a dup entry
    let h = createNavHistory(entry('a', '/'));
    h = recordNavigation(h, 'PUSH', entry('b', '/projects/1'));
    h = recordNavigation(h, 'PUSH', entry('c', '/projects/1'));
    expect(stepDelta(h, -1)).toBe(-2);
  });

  it('returns null when only duplicates of the current URL remain', () => {
    let h = createNavHistory(entry('a', '/x'));
    h = recordNavigation(h, 'PUSH', entry('b', '/x'));
    expect(stepDelta(h, -1)).toBeNull();
  });

  it('walks the full example: home → project → docs → files → docs and back again', () => {
    let h = createNavHistory(entry('0', '/'));
    for (const [k, href] of [
      ['1', '/projects/1'],
      ['2', '/projects/1/docs'],
      ['3', '/projects/1/files'],
      ['4', '/projects/1/docs'],
    ] as const) {
      h = recordNavigation(h, 'PUSH', entry(k, href));
    }
    // all the way back
    const backHrefs: string[] = [];
    for (let d = stepDelta(h, -1); d !== null; d = stepDelta(h, -1)) {
      h = recordNavigation(h, 'POP', h.entries[h.index + d]);
      backHrefs.push(h.entries[h.index].href);
    }
    expect(backHrefs).toEqual(['/projects/1/files', '/projects/1/docs', '/projects/1', '/']);
    // all the way forward
    const fwdHrefs: string[] = [];
    for (let d = stepDelta(h, 1); d !== null; d = stepDelta(h, 1)) {
      h = recordNavigation(h, 'POP', h.entries[h.index + d]);
      fwdHrefs.push(h.entries[h.index].href);
    }
    expect(fwdHrefs).toEqual(['/projects/1', '/projects/1/docs', '/projects/1/files', '/projects/1/docs']);
  });
});
