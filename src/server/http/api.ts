import type { I18nParams, MessageKey } from "@/shared/i18n";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly key: MessageKey | string,
    public readonly params: I18nParams = {},
  ) {
    super(key);
  }
}

export function errorBody(error: unknown) {
  if (error instanceof AppError) {
    return {
      body: { error: { key: error.key, params: error.params } },
      status: error.status,
    };
  }
  if (error instanceof Error) {
    return {
      body: { error: { key: "errors.internal", params: {} } },
      status: 500,
    };
  }
  return {
    body: { error: { key: "errors.internal", params: {} } },
    status: 500,
  };
}
