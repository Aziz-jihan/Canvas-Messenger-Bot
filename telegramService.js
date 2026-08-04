import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Standard Telegram Inline Keyboard Grid (2x2 layout)
export const MAIN_MENU_KEYBOARD = {
    inline_keyboard: [
        [
            { text: "📢 Announcements", callback_data: "GET_ANNOUNCEMENTS" },
            { text: "📊 Grades", callback_data: "GET_GRADES" }
        ],
        [
            { text: "📚 My Courses", callback_data: "GET_COURSES" },
            { text: "📝 Assignments", callback_data: "GET_ASSIGNMENT" }
        ]
    ]
};

/**
 * Low-level helper to send any request to Telegram Bot API
 */
async function callTelegramAPI(method, payload) {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('Error: TELEGRAM_BOT_TOKEN is not set in environment variables.');
        return null;
    }
    try {
        const response = await axios.post(`${TELEGRAM_API_BASE}/${method}`, payload);
        return response.data;
    } catch (error) {
        console.error(`Telegram API Error (${method}):`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Send a message to a Telegram user with optional inline buttons
 */
export async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };

    if (replyMarkup) {
        payload.reply_markup = replyMarkup;
    }

    return await callTelegramAPI('sendMessage', payload);
}

/**
 * Send the main menu with interactive inline buttons
 */
export async function sendTelegramMenu(chatId, textMessage) {
    return await sendTelegramMessage(chatId, textMessage, MAIN_MENU_KEYBOARD);
}

/**
 * Acknowledge Telegram callback queries (button taps) to clear loading state
 */
export async function answerCallbackQuery(callbackQueryId, text = '') {
    return await callTelegramAPI('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text: text
    });
}

/**
 * Automatically set Telegram Webhook URL
 */
export async function setTelegramWebhook(webhookUrl) {
    console.log(`Setting Telegram Webhook to: ${webhookUrl}...`);
    return await callTelegramAPI('setWebhook', {
        url: webhookUrl
    });
}
