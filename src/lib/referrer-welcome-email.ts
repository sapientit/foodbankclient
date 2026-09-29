import * as z from 'zod';
import rawTemplate from './referrer-welcome-email.config.json';

/**
 * The email an administrator is offered after authorising one referrer's exact
 * address — never a domain rule. `screenDetails.md`, "#Valid referrers".
 *
 * **Nothing is sent from here.** This builds a Gmail compose URL and opens it
 * in the administrator's own Google account, where they edit the text and send
 * it themselves. No OAuth scope and no Google project setting is involved: it
 * is a link, and Gmail recognises the account from the browser's own Google
 * sign-in. The referrer's address, name and organisation do travel to Google in
 * that URL — the charity accepted that on 2026-09-29, recorded in
 * `docs/engineering/personal-data.md`.
 *
 * The wording in `referrer-welcome-email.config.json` is the charity's, and is
 * the same from both places that open it. It is JSON so the charity's own text can
 * replace it without touching code; a change still needs a redeploy.
 */

const PLACEHOLDERS = ['referrerName', 'organisationName', 'adminName'] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

export type WelcomeEmailValues = Readonly<Record<Placeholder, string | null>>;

const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/g;

function isPlaceholder(name: string): name is Placeholder {
  return (PLACEHOLDERS as readonly string[]).includes(name);
}

/** An unknown `{name}` would reach the referrer verbatim, so it fails at load instead. */
function onlyKnownPlaceholders(text: string): boolean {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].every(([, name]) => isPlaceholder(name ?? ''));
}

const templateText = z
  .string()
  .refine(onlyKnownPlaceholders, 'Use only {referrerName}, {organisationName} or {adminName}.');

const templateSchema = z.object({
  subject: templateText,
  body: z.array(templateText).min(1),
  blanks: z.object({
    // Empty on purpose: the charity wants an unknown name left out, so the greeting is just "Hi".
    referrerName: z.string(),
    organisationName: z.string().min(1),
    adminName: z.string().min(1),
  }),
});

export type WelcomeEmailTemplate = z.infer<typeof templateSchema>;

/** Parses the template JSON before it is allowed into the running client. */
export function parseWelcomeEmailTemplate(value: unknown): WelcomeEmailTemplate {
  return templateSchema.parse(value);
}

export const welcomeEmailTemplate = parseWelcomeEmailTemplate(rawTemplate);

/**
 * A missing or blank value takes the template's own fallback. A fallback may be
 * empty, so a line is trimmed at its end rather than left with the space
 * before a name that is not there.
 */
export function fillWelcomeEmailText(
  text: string,
  values: WelcomeEmailValues,
  blanks: WelcomeEmailTemplate['blanks'],
): string {
  return text
    .replace(PLACEHOLDER_PATTERN, (match, name: string) => {
      if (!isPlaceholder(name)) return match;
      const value = values[name]?.trim() ?? '';
      return value === '' ? blanks[name] : value;
    })
    .trimEnd();
}

/**
 * `authuser` names the administrator's own address, so Gmail opens in that
 * account even when the browser is signed in to several.
 */
export function welcomeEmailComposeUrl(
  {
    adminEmail,
    referrerEmail,
    values,
  }: { adminEmail: string; referrerEmail: string; values: WelcomeEmailValues },
  template: WelcomeEmailTemplate = welcomeEmailTemplate,
): string {
  const params = new URLSearchParams({
    authuser: adminEmail,
    view: 'cm',
    // Full-window compose rather than Gmail's small pop-up over the inbox: display only.
    fs: '1',
    to: referrerEmail,
    su: fillWelcomeEmailText(template.subject, values, template.blanks),
    body: template.body
      .map((line) => fillWelcomeEmailText(line, values, template.blanks))
      .join('\n'),
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Opens the compose window in a new tab, which the browser focuses. Returns
 * false when the browser blocked it — the call comes after the server has
 * answered, outside the click's user activation, and Safari and Firefox may
 * refuse it — so the caller can offer the same URL as a link instead.
 *
 * Not `noopener` in the features string: with it `window.open` returns `null`
 * every time and a blocked tab is indistinguishable from an opened one. The
 * opener is cut by hand instead.
 */
export function openWelcomeEmail(url: string): boolean {
  const opened = window.open(url, '_blank');
  if (opened === null) return false;
  opened.opener = null;
  return true;
}
