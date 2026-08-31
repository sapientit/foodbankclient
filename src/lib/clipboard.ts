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
