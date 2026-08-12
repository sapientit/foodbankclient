/** Query keys for the standalone fuel-help workflow. */
export const fuelHelpKeys = {
  all: ['fuel-help'] as const,
  list: () => [...fuelHelpKeys.all, 'list'] as const,
};
