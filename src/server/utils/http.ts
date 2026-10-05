const timeoutMs = 8000;

export async function fetchText(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal }).then((res) => res.text().then((text) => ({ res, text })));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`${host(url)} request timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}) {
  const { res, text } = await fetchText(url, init);
  if (!res.ok) throw new Error(`${host(url)} HTTP ${res.status} ${reason(text || res.statusText)}`.trim());
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new Error(`${host(url)} invalid JSON ${reason(text)}`);
  }
}

export function reason(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function host(url: string) {
  return new URL(url).host;
}
