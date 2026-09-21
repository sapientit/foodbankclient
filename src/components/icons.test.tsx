import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RestoreIcon, TrashIcon } from './icons';

it('draws restore as a circular arrow rather than the permanent-delete bin', () => {
  const { container: restored } = render(<RestoreIcon />);
  const { container: deleted } = render(<TrashIcon />);

  expect(restored.querySelector('path[d="M5 7a8 8 0 1 1 2.3 5.7"]')).not.toBeNull();
  expect(restored.querySelector('path[d="M5 7h14"]')).toBeNull();
  expect(deleted.querySelector('path[d="M5 7h14"]')).not.toBeNull();
});
