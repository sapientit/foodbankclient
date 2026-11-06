/**
 * Writes text to the clipboard, resolving `false` rather than throwing where
 * the clipboard is unavailable or refused — an insecure origin, an older
 * browser, a denied permission.
 *
 * A caller must always leave the value reachable another way (selectable on the
 * screen, or a sheet that prints regardless), so a copy button is a convenience
 * and never the only path.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The same promise, carrying an HTML version alongside the text for a program
 * that can read it.
 *
 * Deliberately no fall back to text alone, where the HTML is what protects the
 * values: pasted as text, Excel dropped a phone number's leading zero and ran an
 * answer beginning `=` as a formula, while the copy appeared to have worked. The
 * caller says it failed instead.
 */
export async function copyHtmlToClipboard(html: string, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
