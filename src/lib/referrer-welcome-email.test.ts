import { afterEach, describe, expect, it, vi } from 'vitest';
import rawTemplate from './referrer-welcome-email.config.json';
import {
  fillWelcomeEmailText,
  openWelcomeEmail,
  parseWelcomeEmailTemplate,
  welcomeEmailComposeUrl,
  type WelcomeEmailTemplate,
} from './referrer-welcome-email';

const TEMPLATE: WelcomeEmailTemplate = {
  subject: 'Welcome, {organisationName}',
  body: ['Hello {referrerName},', '', 'Fish & chips + 10% — café', '{adminName}'],
  blanks: { referrerName: 'there', organisationName: 'your organisation', adminName: 'The team' },
};

function composeParams(url: string): URLSearchParams {
  const parsed = new URL(url);
  expect(parsed.origin + parsed.pathname).toBe('https://mail.google.com/mail/');
  return parsed.searchParams;
}

describe('the welcome email template', () => {
  it('parses the shipped config', () => {
    expect(() => parseWelcomeEmailTemplate(rawTemplate)).not.toThrow();
  });

  it('refuses a placeholder the email cannot fill, rather than send it to the referrer verbatim', () => {
    expect(() => parseWelcomeEmailTemplate({ ...TEMPLATE, body: ['Hello {firstName}'] })).toThrow(
      /\{referrerName\}/,
    );
    expect(() => parseWelcomeEmailTemplate({ ...TEMPLATE, subject: 'Hi {sessionDate}' })).toThrow();
  });
});

describe('filling the welcome email', () => {
  it('replaces every placeholder with its value', () => {
    expect(
      fillWelcomeEmailText(
        '{referrerName} of {organisationName}, from {adminName}',
        { referrerName: 'Anna', organisationName: 'Riverside', adminName: 'Pete' },
        TEMPLATE.blanks,
      ),
    ).toBe('Anna of Riverside, from Pete');
  });

  it('uses the blank fallback for a missing or empty value, never an empty gap', () => {
    expect(
      fillWelcomeEmailText(
        'Hello {referrerName}, {adminName}',
        { referrerName: null, organisationName: 'Riverside', adminName: '  ' },
        TEMPLATE.blanks,
      ),
    ).toBe('Hello there, The team');
  });

  it('leaves an unknown name out, without a stray space where it would have been', () => {
    expect(
      fillWelcomeEmailText(
        'Hi {referrerName}',
        { referrerName: null, organisationName: null, adminName: null },
        { ...TEMPLATE.blanks, referrerName: '' },
      ),
    ).toBe('Hi');
  });
});

describe('the Gmail compose URL', () => {
  it('opens compose in the administrator’s own account, addressed to the referrer', () => {
    const params = composeParams(
      welcomeEmailComposeUrl(
        {
          adminEmail: 'pete@charity.org',
          referrerEmail: 'anna@riverside.org',
          values: { referrerName: 'Anna', organisationName: 'Riverside', adminName: 'Pete' },
        },
        TEMPLATE,
      ),
    );

    expect(params.get('authuser')).toBe('pete@charity.org');
    expect(params.get('view')).toBe('cm');
    expect(params.get('to')).toBe('anna@riverside.org');
    expect(params.get('su')).toBe('Welcome, Riverside');
  });

  it('keeps line breaks, ampersands, plus signs and accents in the body intact', () => {
    const params = composeParams(
      welcomeEmailComposeUrl(
        {
          adminEmail: 'pete@charity.org',
          referrerEmail: 'anna@riverside.org',
          values: { referrerName: null, organisationName: 'Riverside', adminName: 'Pete' },
        },
        TEMPLATE,
      ),
    );

    expect(params.get('body')).toBe('Hello there,\n\nFish & chips + 10% — café\nPete');
  });
});

describe('opening the welcome email', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a new tab and cuts its link back to this page', () => {
    const tab = { opener: window };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);

    expect(openWelcomeEmail('https://mail.google.com/mail/?view=cm')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://mail.google.com/mail/?view=cm', '_blank');
    expect(tab.opener).toBeNull();
  });

  it('reports a tab the browser blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openWelcomeEmail('https://mail.google.com/mail/?view=cm')).toBe(false);
  });
});
