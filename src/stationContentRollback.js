import worker from './worker.js';
import { createContentRollbackWorker } from './redesign/contentRollback.js';
export default createContentRollbackWorker(worker);
