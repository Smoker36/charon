import { startCharon } from './src/app.js';
import { logError } from './src/utils.js';

process.on('uncaughtException', (err) => {
  logError('process', `uncaughtException: ${err.message}\n${err.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  logError('process', `unhandledRejection: ${msg}`);
});

startCharon().catch((error) => {
  logError('process', `startup failed: ${error.message}\n${error.stack}`);
  process.exit(1);
});
