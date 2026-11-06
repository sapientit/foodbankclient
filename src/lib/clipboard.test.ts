import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyHtmlToClipboard } from './clipboard';

/** jsdom has neither `ClipboardItem` nor a clipboard; keep the parts so a test can read them. */
class FakeClipboardItem {
  readonly items: Record<string, Blob>;
  constructor(items: Record<string, Blob>) {
    this.items = items;
  }
}

function stubClipboard(clipboard: {
  write?: (items: FakeClipboardItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  }
});

describe('copyHtmlToClipboard', () => {
  it('writes the html and the plain text together as one clipboard item', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn<(items: FakeClipboardItem[]) => Promise<void>>().mockResolvedValue();
    stubClipboard({ write });

    await expect(copyHtmlToClipboard('<table></table>', 'a\tb')).resolves.toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    const [items] = write.mock.calls[0] ?? [];
    expect(items).toHaveLength(1);
    const parts = items?.[0]?.items ?? {};
    expect(Object.keys(parts).sort()).toEqual(['text/html', 'text/plain']);
    expect(await parts['text/html']?.text()).toBe('<table></table>');
    expect(parts['text/html']?.type).toBe('text/html');
    expect(await parts['text/plain']?.text()).toBe('a\tb');
    expect(parts['text/plain']?.type).toBe('text/plain');
  });

  it('never falls back to text alone where the browser has no ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    stubClipboard({ writeText });

    await expect(copyHtmlToClipboard('<table></table>', 'a\tb')).resolves.toBe(false);

    expect(writeText).not.toHaveBeenCalled();
  });

  it('never falls back to text alone where the browser refuses the write', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi
      .fn<(items: FakeClipboardItem[]) => Promise<void>>()
      .mockRejectedValue(new Error('Denied'));
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    stubClipboard({ write, writeText });

    await expect(copyHtmlToClipboard('<table></table>', 'a\tb')).resolves.toBe(false);

    expect(writeText).not.toHaveBeenCalled();
  });
});
