export const voucherKeys = {
  all: ['voucher-config'] as const,
  config: () => [...voucherKeys.all, 'config'] as const,
};
