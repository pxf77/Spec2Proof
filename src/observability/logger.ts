export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(minimumLevel: LogLevel): Logger {
  const write = (
    level: LogLevel,
    message: string,
    fields: Record<string, unknown> = {},
  ): void => {
    if (priorities[level] < priorities[minimumLevel]) {
      return;
    }
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(redact(fields) as Record<string, unknown>),
    };
    const output = JSON.stringify(record);
    if (level === "error") {
      console.error(output);
    } else {
      console.log(output);
    }
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /password|secret|token|authorization|cookie/iu.test(key) ? "[REDACTED]" : redact(item),
    ]),
  );
}
