type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

class Logger {
  private level: LogLevel;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
    this.level = (envLevel in LOG_LEVELS) ? envLevel as LogLevel : 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (data !== undefined) {
      const sanitized = this.sanitizeData(data);
      return `${prefix} ${message} ${JSON.stringify(sanitized)}`;
    }

    return `${prefix} ${message}`;
  }

  private sanitizeData(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const sanitized = Array.isArray(data) ? [...data] : { ...data };

    const sensitiveKeys = ['key', 'token', 'secret', 'password', 'api_key', 'apikey'];

    for (const key in sanitized) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeData(sanitized[key]);
      }
    }

    return sanitized;
  }

  debug(_message: string, _data?: any): void {
    if (this.shouldLog('debug')) {
      // Debug should not output anything unless explicitly enabled
      // Never write to stdout/stderr during normal operation
    }
  }

  info(_message: string, _data?: any): void {
    if (this.shouldLog('info')) {
      // Info should not output anything to avoid polluting stdio
      // Only warnings and errors should go to stderr
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      console.error(this.formatMessage('warn', message, data));
    }
  }

  error(message: string, error?: any): void {
    if (this.shouldLog('error')) {
      const errorData = error instanceof Error ? {
        errorMessage: error.message,
        stack: error.stack,
        ...error
      } : error;
      console.error(this.formatMessage('error', message, errorData));
    }
  }
}

export const logger = new Logger();