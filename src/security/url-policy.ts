export interface UrlPolicyOptions {
  allowedHosts: readonly string[];
  allowHttp?: boolean;
  allowPrivateHosts?: boolean;
}

export class UrlPolicy {
  private readonly allowedHosts: readonly string[];
  private readonly allowHttp: boolean;
  private readonly allowPrivateHosts: boolean;

  public constructor(options: UrlPolicyOptions) {
    if (options.allowedHosts.length === 0) {
      throw new Error("At least one allowed host is required");
    }
    this.allowedHosts = options.allowedHosts.map(normalizeHostRule);
    this.allowHttp = options.allowHttp ?? false;
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
  }

  public assertAllowed(rawUrl: string): URL {
    const url = new URL(rawUrl);
    const protocolAllowed =
      url.protocol === "https:" || (this.allowHttp && url.protocol === "http:");
    if (!protocolAllowed) {
      throw new Error(`URL protocol is not allowed: ${url.protocol}`);
    }

    const hostname = normalizeHostname(url.hostname);
    if (!this.matchesAllowlist(hostname)) {
      throw new Error(`URL host is not allowed: ${hostname}`);
    }
    if (!this.allowPrivateHosts && isPrivateHost(hostname)) {
      throw new Error(`Private or local host is not allowed: ${hostname}`);
    }

    url.username = "";
    url.password = "";
    return url;
  }

  private matchesAllowlist(hostname: string): boolean {
    return this.allowedHosts.some((rule) => {
      if (rule.startsWith("*.")) {
        const suffix = rule.slice(1);
        return hostname.endsWith(suffix) && hostname !== rule.slice(2);
      }
      return hostname === rule;
    });
  }
}

function normalizeHostRule(value: string): string {
  const rule = value.trim().toLowerCase();
  if (rule.length === 0 || /[/?#@]/u.test(rule)) {
    throw new Error(`Invalid host allowlist rule: ${value}`);
  }
  if (rule.startsWith("*.")) {
    return `*.${normalizeHostname(rule.slice(2))}`;
  }
  return normalizeHostname(rule);
}

function normalizeHostname(value: string): string {
  const lower = value.trim().toLowerCase();
  const withoutBrackets =
    lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  return withoutBrackets.endsWith(".")
    ? withoutBrackets.slice(0, -1)
    : withoutBrackets;
}

function isPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".local")) {
    return true;
  }

  if (normalized.includes(":")) {
    return isPrivateIpv6(normalized);
  }

  return isPrivateIpv4(normalized);
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = octets;
  if (a === undefined || b === undefined) {
    return false;
  }
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  if (hostname === "::" || hostname === "::1") {
    return true;
  }

  if (hostname.startsWith("::ffff:")) {
    const mapped = mappedIpv4(hostname.slice("::ffff:".length));
    return mapped ? isPrivateIpv4(mapped) : false;
  }

  const firstPart = hostname.split(":").find((part) => part.length > 0);
  if (!firstPart || !/^[0-9a-f]{1,4}$/u.test(firstPart)) {
    return false;
  }
  const firstHextet = Number.parseInt(firstPart, 16);
  const uniqueLocal = (firstHextet & 0xfe00) === 0xfc00;
  const linkLocal = (firstHextet & 0xffc0) === 0xfe80;
  return uniqueLocal || linkLocal;
}

function mappedIpv4(value: string): string | undefined {
  const parts = value.split(":");
  if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) {
    return undefined;
  }
  const high = Number.parseInt(parts[0]!, 16);
  const low = Number.parseInt(parts[1]!, 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}
