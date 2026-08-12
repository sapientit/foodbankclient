/** Query keys for the administrator-led spreadsheet extract. */
export const extractKeys = {
  all: ['extracts'] as const,
  config: () => [...extractKeys.all, 'config'] as const,
  progress: () => [...extractKeys.all, 'progress'] as const,
};
