import { createDiscreteApi } from "naive-ui";
import { appT } from "@/app/i18n";
import type { I18nParams } from "@/shared/i18n";

interface ApiErrorPayload {
  error?: {
    key?: string;
    params?: I18nParams;
  };
}

interface ApiMessage {
  error(text: string): unknown;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  silent?: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly key: string,
    public readonly params: I18nParams,
    message: string,
    public readonly payload: unknown,
  ) {
    super(message);
  }
}

let apiMessage: ApiMessage | null | undefined;

export function setApiMessage(message: ApiMessage | null) {
  apiMessage = message;
}

export async function request<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const { silent, ...init } = options;
  try {
    const response = await fetch(url, buildRequest(init));
    const payload = await response.json().catch(() => null) as T | ApiErrorPayload | null;
    if (!response.ok) {
      throw apiError(response.status, payload as ApiErrorPayload | null);
    }
    return payload as T;
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(0, "errors.network", {}, appT("errors.network"), null);
    showError(apiError, silent);
    throw apiError;
  }
}

export function get<T>(url: string, options?: ApiRequestOptions) {
  return request<T>(url, { ...options, method: "GET" });
}

export function post<T>(url: string, body?: unknown, options?: ApiRequestOptions) {
  return request<T>(url, { ...options, body, method: "POST" });
}

export function put<T>(url: string, body?: unknown, options?: ApiRequestOptions) {
  return request<T>(url, { ...options, body, method: "PUT" });
}

export function del<T>(url: string, options?: ApiRequestOptions) {
  return request<T>(url, { ...options, method: "DELETE" });
}

export function upload<T>(url: string, body: ArrayBuffer | Blob, contentType: string, options?: ApiRequestOptions) {
  const headers = new Headers(options?.headers);
  headers.set("content-type", contentType);
  return request<T>(url, {
    ...options,
    body,
    headers,
    method: options?.method ?? "PUT",
  });
}

function buildRequest(options: ApiRequestOptions): RequestInit {
  const headers = new Headers(options.headers);
  const body = buildBody(options.body, headers);
  return {
    ...options,
    body,
    credentials: "include",
    headers,
  };
}

function buildBody(body: unknown, headers: Headers): BodyInit | null | undefined {
  if (body == null) return body as null | undefined;
  if (body instanceof ArrayBuffer || (typeof Blob !== "undefined" && body instanceof Blob)) return body;
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(body);
}

function apiError(status: number, payload: ApiErrorPayload | null) {
  const error = payload?.error;
  const key = error?.key || "errors.http";
  const params = error?.params || { status };
  return new ApiError(
    status,
    key,
    params,
    appT(key, params),
    payload,
  );
}

function showError(error: ApiError, silent?: boolean) {
  if (silent) return;
  const message = getApiMessage();
  message?.error(error.message);
}

function getApiMessage() {
  if (apiMessage !== undefined) return apiMessage;
  if (typeof window === "undefined" || typeof document === "undefined") {
    apiMessage = null;
    return apiMessage;
  }
  apiMessage = createDiscreteApi(["message"]).message;
  return apiMessage;
}
