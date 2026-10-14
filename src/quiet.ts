// Node 22 flags its built-in SQLite as experimental on first use. That notice means nothing to a
// skrape user and would print over the UI, so drop exactly that one warning. Imported first in cli.ts.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
