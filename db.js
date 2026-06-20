const dotenv = require("dotenv");

dotenv.config({ path: process.env.ENV_FILE || "/home/BonkDrop/bonkdrop_backend/.env" });

const { Pool } = require("pg");
require
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

module.exports = pool;