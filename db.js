import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Clean DATABASE_URL by removing query param sslmode if present to avoid pg driver warning
const connectionString = process.env.DATABASE_URL ? process.env.DATABASE_URL.split('?')[0] : undefined;

// Neon PostgreSQL Connection Pool
const pool = new Pool({
    connectionString: connectionString || process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

export default pool;
