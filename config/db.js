const pool = require('./database');

const db = {
  // CREATE
  async create(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    const query = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // READ - tek kayıt
  async findOne(table, where = {}) {
    const keys = Object.keys(where);
    const values = Object.values(where);
    const whereClause = keys.length
      ? `WHERE ${keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ')}`
      : '';

    const query = `SELECT * FROM ${table} ${whereClause} LIMIT 1`;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  },

  // READ - tüm kayıtlar
  async findAll(table, where = {}, options = {}) {
    const keys = Object.keys(where);
    const values = Object.values(where);
    const whereClause = keys.length
      ? `WHERE ${keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ')}`
      : '';

    let query = `SELECT * FROM ${table} ${whereClause}`;

    if (options.orderBy) {
      query += ` ORDER BY ${options.orderBy}`;
    }
    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }
    if (options.offset) {
      query += ` OFFSET ${options.offset}`;
    }

    const result = await pool.query(query, values);
    return result.rows;
  },

  // UPDATE
  async update(table, data, where) {
    const dataKeys = Object.keys(data);
    const dataValues = Object.values(data);
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);

    const setClause = dataKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const whereClause = whereKeys.map((k, i) => `${k} = $${dataKeys.length + i + 1}`).join(' AND ');

    const query = `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING *`;
    const result = await pool.query(query, [...dataValues, ...whereValues]);
    return result.rows[0];
  },

  // DELETE
  async delete(table, where) {
    const keys = Object.keys(where);
    const values = Object.values(where);
    const whereClause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');

    const query = `DELETE FROM ${table} WHERE ${whereClause} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // UPSERT
  async upsert(table, data, conflictKey) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const updateClause = keys
      .filter(k => k !== conflictKey)
      .map(k => `${k} = EXCLUDED.${k}`)
      .join(', ');

    const query = `
      INSERT INTO ${table} (${keys.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (${conflictKey})
      DO UPDATE SET ${updateClause}
      RETURNING *
    `;
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Raw query
  async query(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows;
  }
};

module.exports = db;
