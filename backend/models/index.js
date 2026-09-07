/**
 * Legacy Sequelize bootstrap — not used in the active Express routes.
 * Active code uses query-builder models (boxModel.js, logModel.js, etc.)
 * with mysql2 pool directly. ORM models live in orm/models/.
 *
 * Kept for backwards compatibility with scripts that may reference it.
 */
export { default } from '../orm/models/index.js';
export { sequelize } from '../orm/models/index.js';
