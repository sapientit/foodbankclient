export const platformStatsKeys = {
  all: ['platform-stats'] as const,
  usage: (from: string, to: string) => [...platformStatsKeys.all, 'usage', from, to] as const,
  alertSummary: () => [...platformStatsKeys.all, 'alert-summary'] as const,
};
