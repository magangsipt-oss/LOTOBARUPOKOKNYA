'use strict';

// Tabel hasil impor dari server lama memakai utf8mb4_unicode_ci, sedangkan tabel baru mengikuti default
// database MySQL 8 (utf8mb4_0900_ai_ci). MySQL menolak JOIN antar-kolom teks dengan collation berbeda
// ("Illegal mix of collations"). Samakan semua tabel dan default database dengan collation tabel boxes.
const quote = name => `\`${String(name).replace(/`/g, '``')}\``;

module.exports = {
  async up(queryInterface) {
    const query = async (sql, replacements = []) => {
      const [rows] = await queryInterface.sequelize.query(sql, { replacements });
      return rows;
    };
    const [schema] = await query('SELECT DATABASE() AS name');
    const [boxes] = await query(
      `SELECT t.TABLE_COLLATION AS collation_name, c.CHARACTER_SET_NAME AS charset
       FROM information_schema.TABLES t
       JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION
       WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = 'boxes'`, [schema.name]);
    if (!boxes) return;
    const { collation_name: collation, charset } = boxes;

    const [database] = await query('SELECT DEFAULT_COLLATION_NAME AS collation_name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [schema.name]);
    if (database.collation_name !== collation) {
      await query(`ALTER DATABASE ${quote(schema.name)} CHARACTER SET ${charset} COLLATE ${collation}`);
    }
    const mismatched = await query(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' AND TABLE_COLLATION <> ?`, [schema.name, collation]);
    for (const table of mismatched) {
      await query(`ALTER TABLE ${quote(table.name)} CONVERT TO CHARACTER SET ${charset} COLLATE ${collation}`);
    }
  },

  async down() {}
};
