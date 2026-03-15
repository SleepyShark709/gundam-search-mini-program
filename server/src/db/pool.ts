import mysql from 'mysql2/promise';

const addressRaw = process.env.MYSQL_ADDRESS || 'localhost:3306';
const [host, portStr] = addressRaw.split(':');
const port = parseInt(portStr, 10) || 3306;

const pool = mysql.createPool({
  host,
  port,
  user: process.env.MYSQL_USERNAME || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'gundam',
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 5,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

export default pool;
