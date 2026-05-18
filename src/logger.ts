export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error:  1,
  warn:   2,
  info:   3,
  debug:  4,
};

const VALID_LEVELS = Object.keys(LEVELS) as LogLevel[];

let current = LEVELS['info'];

export const logger = {
  setLevel(level: string): void {
    const l = level.toLowerCase() as LogLevel;
    if (!VALID_LEVELS.includes(l)) {
      console.warn(`[logger] unknown level "${level}", using "info". Valid: ${VALID_LEVELS.join(', ')}`);
      return;
    }
    current = LEVELS[l];
  },

  debug(...args: unknown[]): void { if (current >= 4) console.log(...args); },
  info(...args: unknown[]): void  { if (current >= 3) console.log(...args); },
  warn(...args: unknown[]): void  { if (current >= 2) console.warn(...args); },
  error(...args: unknown[]): void { if (current >= 1) console.error(...args); },
};
