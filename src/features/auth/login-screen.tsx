import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import * as z from 'zod';
import foodbankLogo from '../../assets/foodbank-logo.webp';
import { useAuth } from '../../auth/auth-context';
import { postLoginPath } from '../../auth/next-path';
import { reloadForNewerClient } from '../../lib/client-version';
import { ApiError, describeApiError, issuesToFieldErrors } from '../../lib/errors';
import { GoogleSignInButton } from './components/google-sign-in-button';
import { isGoogleSignInMode } from './google-signin';
import styles from './login-screen.module.css';

/**
 * Which sign-in screen a deployment shows is fixed at build time — see
 * `isGoogleSignInMode`. Everything below `LoginScreen` itself is the dummy
 * provider's screen, unchanged from before Google sign-in existed.
 */
export function LoginScreen() {
  return isGoogleSignInMode() ? <GoogleLoginScreen /> : <DummyLoginScreen />;
}

/**
 * Sign in with a Google identity. There is no form here at all: Google's own
 * button produces the credential, and a failed sign-in is Google's UI to
 * explain, not this screen's — the one exception is the server refusing an
 * address with no account, which is this app's own rule and needs its own
 * words.
 */
function GoogleLoginScreen() {
  const { signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (formError !== null) formErrorRef.current?.focus();
  }, [formError]);

  return (
    <main className={styles.screen}>
      <img alt="Foodbank logo" className={styles.banner} src={foodbankLogo} />
      <h1>Sign in</h1>

      <p className={styles.intro}>
        Sign in with the Google account an administrator has added for you.
      </p>

      {searchParams.get('session') === 'ended' && (
        <p className={styles.formError} role="alert">
          Your sign-in has ended. Sign in again to continue.
        </p>
      )}

      {formError !== null && (
        <p className={styles.formError} ref={formErrorRef} role="alert" tabIndex={-1}>
          {formError}
        </p>
      )}

      <GoogleSignInButton
        onCredential={(idToken) => {
          setFormError(null);
          void (async () => {
            try {
              const user = await signInWithGoogle(idToken);
              const nextPath = postLoginPath(searchParams.get('next'), user.role);
              if (await reloadForNewerClient(nextPath)) return;
              await navigate(nextPath, { replace: true });
            } catch (error) {
              setFormError(explainGoogle(error));
            }
          })();
        }}
      />

      <p className={styles.stockTake}>
        Doing a stock take? <Link to="/count">Enter a counting code</Link>
      </p>
    </main>
  );
}

function explainGoogle(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'We could not reach the server. Check the connection and try again.';
  }

  switch (error.status) {
    // Deliberately says nothing about whether the address is registered —
    // same reasoning as the dummy screen's 401, below.
    case 401:
      return 'We could not sign you in. Ask an administrator to add your Google account.';
    case 403: {
      const reason = error.code === 'FORBIDDEN' ? error.message : 'This account is not active.';
      return `${reason} Ask an administrator to reactivate it.`;
    }
    case 404:
      return 'Google sign-in is not enabled on this server. Tell whoever deployed it.';
    default:
      return describeApiError(error);
  }
}

/**
 * Sign in. **Email only, and that is the whole form.**
 *
 * `POST /auth/dev-login` accepts `{ email }` and nothing else — it is a plain
 * object schema, so a `role` or `displayName` sent alongside is silently
 * stripped rather than refused. A role picker here would therefore be a control
 * that appears to work, changes nothing, and takes a week to diagnose. Both come
 * from the `users` row, and only an admin can change them.
 *
 * The email is never logged and never put in a URL. It identifies a person.
 */

const signInSchema = z.object({
  email: z.email('Enter the email address an administrator has added for you.'),
});

type SignInValues = z.infer<typeof signInSchema>;

/**
 * The bootstrap admin a freshly migrated database contains, from the server's
 * `0007_bootstrap-admin.sql`, and the team lead this project's own convention
 * creates through user maintenance. A literal, in source, behind
 * `import.meta.env.DEV` so the whole block is dropped from the production bundle —
 * and it writes nothing anywhere, because "remember me" on a shared laptop is how
 * the last volunteer's session becomes the next one's.
 *
 * **`lead@x.com` only works once an admin has added it.** There is deliberately
 * no second bootstrap migration for a team lead: it would create an account
 * nobody asked for in production, and remove the one thing that forces us to
 * dogfood the screen that creates it.
 */
const DEV_ACCOUNTS = ['pete@x.com', 'lead@x.com'];

function DummyLoginScreen() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const emailId = useId();
  const emailErrorId = useId();
  const formErrorId = useId();

  const [formError, setFormError] = useState<string | null>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
    setValue,
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '' },
  });

  // Somebody using a screen reader needs to land on the reason, not hunt for it.
  useEffect(() => {
    if (formError !== null) formErrorRef.current?.focus();
  }, [formError]);

  const submit = handleSubmit(async ({ email }) => {
    setFormError(null);

    try {
      const user = await signIn(email);
      const nextPath = postLoginPath(searchParams.get('next'), user.role);
      if (await reloadForNewerClient(nextPath)) return;
      await navigate(nextPath, { replace: true });
    } catch (error) {
      setFormError(explain(error, setError));
    }
  });

  const emailError = errors.email?.message;

  return (
    <main className={styles.screen}>
      <img alt="Foodbank logo" className={styles.banner} src={foodbankLogo} />
      <h1>Sign in</h1>

      <p className={styles.intro}>
        Sign in with the email address an administrator has added for you. Your name and what you
        can do come from that account.
      </p>

      {searchParams.get('session') === 'ended' && (
        <p className={styles.formError} role="alert">
          Your sign-in has ended. Sign in again to continue.
        </p>
      )}

      {formError !== null && (
        <p
          className={styles.formError}
          id={formErrorId}
          ref={formErrorRef}
          role="alert"
          tabIndex={-1}
        >
          {formError}
        </p>
      )}

      <form
        noValidate
        onSubmit={(event) => {
          // React Hook Form also cancels this, but the form boundary must do
          // so itself: Safari otherwise falls back to a native page reload
          // before the asynchronous sign-in request begins.
          event.preventDefault();
          void submit();
        }}
      >
        <div className={styles.field}>
          <label htmlFor={emailId}>Email address</label>
          <input
            {...register('email')}
            aria-describedby={emailError === undefined ? undefined : emailErrorId}
            aria-invalid={emailError === undefined ? undefined : true}
            autoComplete="email"
            className={styles.input}
            id={emailId}
            type="email"
          />
          {emailError !== undefined && (
            <p className={styles.fieldError} id={emailErrorId}>
              {emailError}
            </p>
          )}
        </div>

        <button
          className={styles.submit}
          disabled={isSubmitting}
          onClick={() => void submit()}
          type="button"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className={styles.stockTake}>
        {/* The people who walk the shelves counting stock have no account and
            never will. They get here with a code a team lead read out. */}
        Doing a stock take? <Link to="/count">Enter a counting code</Link>
      </p>

      {import.meta.env.DEV && (
        <div className={styles.devHint}>
          <p>
            Development sign-in. A freshly migrated database contains only the first of these; add a
            team lead through user maintenance once you are in as the admin.
          </p>
          <ul className={styles.devHintList}>
            {DEV_ACCOUNTS.map((email) => (
              <li key={email}>
                <button
                  className="button-plain"
                  onClick={() => {
                    setValue('email', email, { shouldValidate: true });
                  }}
                  type="button"
                >
                  {email}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

/**
 * Turns a failed sign-in into one sentence, and applies field errors for a 400.
 */
function explain(
  error: unknown,
  setFieldError: ReturnType<typeof useForm<SignInValues>>['setError'],
): string {
  if (!(error instanceof ApiError)) {
    return 'We could not reach the server. Check the connection and try again.';
  }

  switch (error.status) {
    case 400: {
      // Every form field is named exactly as its API body key, so the server's
      // dot-joined paths need no translation. See issuesToFieldErrors.
      for (const [path, message] of Object.entries(issuesToFieldErrors(error))) {
        if (path === 'email') setFieldError('email', { message });
      }
      return 'Check the address and try again.';
    }

    /*
     * Deliberately says nothing about whether the address is registered.
     *
     * The server returns the same 401 for an unknown address and for a rejected
     * credential, precisely so that sign-in is not an oracle for "does this
     * person have an account here". Naming which one failed would hand that
     * back. Do not "improve" this message.
     */
    case 401:
      return 'We could not sign you in. Check the address, or ask an administrator to add you.';

    /*
     * The charter's rule is that a 403 is a bug, because roles pick menus and
     * never gate routes. This is the one deliberate exception: a deactivated
     * account is a real answer to a real request, and the server's message says
     * so in words meant for the person reading them.
     */
    case 403: {
      // `openapi.yaml` declares no body on this response, so the envelope is not
      // guaranteed. `code` is only ever `FORBIDDEN` when one actually parsed —
      // otherwise `message` is the generic apology, which would read as
      // nonsense here.
      const reason = error.code === 'FORBIDDEN' ? error.message : 'This account is not active.';
      return `${reason} Ask an administrator to reactivate it.`;
    }

    // The route only exists when the server runs with AUTH_MODE=dummy. A 404
    // means this build is pointed at a server that has no development sign-in —
    // a misconfiguration, and nothing the person typing can fix.
    case 404:
      return 'Development sign-in is not enabled on this server. Tell whoever deployed it.';

    default:
      return describeApiError(error);
  }
}
