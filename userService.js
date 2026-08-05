import pool from './db.js';
import { validateToken } from './canvasService.js';

/**
 * Fetch user record by Telegram PSID from Neon DB
 */
export async function getUser(psid) {
    try {
        const result = await pool.query('SELECT * FROM users WHERE psid = $1', [psid]);
        return result.rows[0] || null;
    } catch (error) {
        console.error(`DB ERROR in getUser for PSID ${psid}:`, error.message);
        return null;
    }
}

/**
 * Save or update user Canvas token in Neon DB
 */
export async function saveUser(psid, canvasToken) {
    try {
        const query = `
            INSERT INTO users (psid, canvas_token, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (psid)
            DO UPDATE SET canvas_token = EXCLUDED.canvas_token, updated_at = CURRENT_TIMESTAMP;
        `;
        await pool.query(query, [psid, canvasToken]);
        console.log(`User ${psid} token successfully saved/updated in Neon DB.`);
        return true;
    } catch (error) {
        console.error(`DB ERROR in saveUser for PSID ${psid}:`, error.message);
        throw error;
    }
}

/**
 * Check if a user's token exists and is valid by sending a test GET request to Canvas API (/users/self)
 */
export async function isTokenValid(user) {
    if (!user || !user.canvas_token) {
        return false;
    }

    const validation = await validateToken(user.canvas_token);
    return validation.valid;
}

