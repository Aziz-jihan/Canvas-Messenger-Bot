import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { Courses, Announcements, Grades, Assignments } from './messageFormatter.js';
import { validateToken } from './canvasService.js';
import { getUser, saveUser, isTokenValid } from './userService.js';
import { 
    sendTelegramMessage, 
    sendTelegramMenu, 
    answerCallbackQuery, 
    setTelegramWebhook 
} from './telegramService.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL;

// 1. GET /set-telegram-webhook — Automatically connects Telegram to Render
// One time use
app.get('/set-telegram-webhook', async (req, res) => {
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers.host;
        const baseUrl = APP_URL || `${protocol}://${host}`;
        const webhookUrl = `${baseUrl}/telegram-webhook`;

        const result = await setTelegramWebhook(webhookUrl);
        return res.send(`✅ Telegram Webhook set successfully to: <strong>${webhookUrl}</strong><br><pre>${JSON.stringify(result, null, 2)}</pre>`);
    } catch (error) {
        return res.status(500).send(`❌ Error setting Telegram Webhook: ${error.message}`);
    }
});



// 2. GET /register — Serves the Registration Form
app.get('/register', (req, res) => {
    res.sendFile(path.resolve('public', 'register.html'));
});

// 3. POST /api/register — Validates Canvas Token & Saves to Neon DB
app.post('/api/register', async (req, res) => {
    const { psid: chatId, canvas_token } = req.body;

    if (!chatId || !canvas_token) {
        return res.status(400).json({ success: false, message: 'Missing Chat ID or Canvas Token' });
    }

    console.log(`Validating Canvas Token for Telegram Chat ID: ${chatId}...`);
    const validation = await validateToken(canvas_token.trim());

    if (!validation.valid) {
        return res.json({ success: false, message: validation.error || 'Invalid Canvas Access Token' });
    }

    try {
        // Save token to Neon DB
        await saveUser(chatId, canvas_token.trim());

        // Send a welcome message directly in Telegram!
        const studentName = validation.user?.name ? `, ${validation.user.name}` : '';
        await sendTelegramMenu(
            chatId,
            `🎉 <b>Welcome ${studentName}!</b>\n\nYour account has been connected successfully. Use the menu buttons below to explore your Canvas data:`
        );

        return res.json({ success: true, name: validation.user?.name || 'Student' });
    } catch (err) {
        console.error('Failed to register user:', err.message);
        return res.status(500).json({ success: false, message: 'Database error saving token' });
    }
});

// 4. POST /telegram-webhook — Receives incoming Telegram messages & button clicks
app.post('/telegram-webhook', async (req, res) => {
    // Return 200 OK immediately to Telegram
    res.status(200).send('OK');

    const update = req.body;
    if (!update) return;

    try {
        // A. Handle Inline Button Clicks (callback_query)
        if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const chatId = callbackQuery.message.chat.id;
            const payload = callbackQuery.data;

            // Acknowledge callback query to stop button loading spinner
            await answerCallbackQuery(callbackQuery.id);

            const user = await getUser(chatId);
            const valid = await isTokenValid(user);

            if (!valid) {
                await sendRegistrationLink(req, chatId, user ? 'expired' : 'new');
                return;
            }

            console.log(`Telegram Button Clicked: ${payload} by Chat ID: ${chatId}`);
            await handleOptionSelected(chatId, payload, user.canvas_token);
        }

        // B. Handle User Text Messages or /start command
        else if (update.message) {
            const message = update.message;
            const chatId = message.chat.id;
            const text = message.text || '';

            const user = await getUser(chatId);
            // Check if user is registered and token is valid
            const valid = await isTokenValid(user);

            if (!valid) {
                await sendRegistrationLink(req, chatId, user ? 'expired' : 'new');
                return;
            }

            // User is registered & valid
            if (text === '/start') {
                await sendTelegramMenu(chatId, "👋 <b>Welcome back to Canvas LMS Bot!</b>\n\nSelect an option below to fetch your data:");
            } else {
                await sendTelegramMenu(chatId, "Aree bhokchod naki. Nicher options select koro:");
            }
        }
    } catch (err) {
        console.error('Error handling Telegram webhook update:', err.message);
    }
});

// Send Registration Link to unregistered or expired users
async function sendRegistrationLink(req, chatId, status) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers.host;
    const baseUrl = APP_URL || `${protocol}://${host}`;

    const registerUrl = `${baseUrl}/register?chat_id=${chatId}`;

    let intro = "👋 <b>Welcome!</b>";
    if (status === 'expired') {
        intro = "⚠️ <b>Your Canvas token has expired</b> (tokens are valid for 30 days).";
    }

    const messageText = `${intro}\n\nPlease click the button below to connect your Canvas account:`;

    const inlineKeyboard = {
        inline_keyboard: [
            [
                { text: "🎓 Connect Canvas Account", url: registerUrl }
            ]
        ]
    };

    await sendTelegramMessage(chatId, messageText, inlineKeyboard);
}

// Handle option selection by fetching REAL Canvas data for specific user token
async function handleOptionSelected(chatId, payload, canvasToken) {
    let responseText = "";

    try {
        switch (payload) {
            case "GET_ANNOUNCEMENTS": {
                responseText = await Announcements(canvasToken);
                break;
            }
            case "GET_GRADES": {
                responseText = await Grades(canvasToken);
                break;
            }
            case "GET_COURSES": {
                responseText = await Courses(canvasToken);
                break;
            }
            case "GET_ASSIGNMENT": {
                responseText = await Assignments(canvasToken);
                break;
            }
            default:
                responseText = "I didn't understand that option.";
        }
    } catch (err) {
        console.error("Canvas Service Error:", err.message);
        responseText = "⚠️ Unable to fetch data from Canvas right now. Please make sure your token is valid.";
    }

    await sendTelegramMenu(chatId, responseText);
}





app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
