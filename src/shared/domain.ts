export function toDomain(value: unknown) {
  const raw = String(value || "").trim().replace(/^(?:https?:\/\/)+/i, "").replace(/^\/+/, "");
  return raw.split(/[/?#]/)[0].replace(/:\d+$/, "").toLowerCase();
}

export function isDomain(value: unknown) {
  const host = toDomain(value);
  const domain = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z][a-z0-9-]{1,62}$/;
  return domain.test(host)
    && host !== "localhost"
    && !host.endsWith(".local")
    && !/^(\d{1,3}\.){3}\d{1,3}$/.test(host);
}

export function toSiteUrl(host: unknown) {
  const domain = toDomain(host);
  if (!isDomain(domain)) throw new Error("invalid domain");
  return `https://${domain}`;
}

export function toHttpsSiteUrl(value: unknown) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("invalid domain");
  return toSiteUrl(url.hostname);
}
