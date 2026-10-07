import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetTurnstileLoaderForTests } from '../turnstile';
import { TurnstileCheck } from './turnstile-check';

interface FakeWidget {
  readonly id: string;
  readonly emitToken: (token: string) => void;
  readonly expire: () => void;
  readonly fail: (errorCode: string) => boolean;
}

function installTurnstileStub() {
  const rendered: FakeWidget[] = [];
  const reset = vi.fn();

  window.turnstile = {
    render: (_container, options) => {
      const id = `widget-${String(rendered.length)}`;
      rendered.push({
        id,
        emitToken: options.callback,
        expire: options['expired-callback'],
        fail: options['error-callback'],
      });
      return id;
    },
    reset,
    remove: vi.fn(),
  };

  return { rendered, reset };
}

async function renderConfiguredCheck() {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
  const { rendered, reset } = installTurnstileStub();
  const onToken = vi.fn();

  render(<TurnstileCheck onToken={onToken} resetSignal={0} />);

  await waitFor(() => {
    expect(rendered).toHaveLength(1);
  });
  const widget = rendered[0];
  if (widget === undefined) throw new Error('The widget was not rendered.');

  return { onToken, reset, widget };
}

describe('TurnstileCheck callbacks', () => {
  // These callbacks have no dependency on the referral wizard. Testing them
  // here keeps the expiry/recovery contract fast even when the full form is
  // under load in a deployment check.
  afterEach(() => {
    resetTurnstileLoaderForTests();
    Reflect.deleteProperty(window, 'turnstile');
  });

  it('drops an expired token and resets the widget for a fresh one', async () => {
    const { onToken, reset, widget } = await renderConfiguredCheck();

    act(() => {
      widget.emitToken('tok-ready');
      widget.expire();
    });

    expect(onToken).toHaveBeenNthCalledWith(1, 'tok-ready');
    expect(onToken).toHaveBeenNthCalledWith(2, null);
    expect(reset).toHaveBeenCalledWith(widget.id);
  });

  it('retries one transient check failure, then gives a useful error instead of looping', async () => {
    const { onToken, reset, widget } = await renderConfiguredCheck();

    act(() => {
      expect(widget.fail('200500')).toBe(false);
    });
    expect(onToken).toHaveBeenCalledWith(null);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('The security check had a temporary problem. It is trying once more.'),
    ).toBeInTheDocument();

    act(() => {
      expect(widget.fail('200500')).toBe(false);
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The security check could not connect. Please check your connection and try again; if it still cannot pass, phone the food bank and they will take the referral over the phone.',
    );
  });
});
