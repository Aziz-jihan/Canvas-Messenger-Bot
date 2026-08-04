import express from 'express';
import dotenv from 'dotenv';
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
    const chatId = req.query.chat_id || req.query.psid || '';
    res.send(getRegistrationHTML(chatId));
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
            `🎉 <b>Welcome to Canvas LMS Bot${studentName}!</b>\n\nYour account has been connected successfully. Your token is valid for 30 days. Use the menu buttons below to explore your Canvas data:`
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
            const valid = isTokenValid(user);

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
            const valid = isTokenValid(user);

            if (!valid) {
                await sendRegistrationLink(req, chatId, user ? 'expired' : 'new');
                return;
            }

            // User is registered & valid
            if (text === '/start') {
                await sendTelegramMenu(chatId, "👋 <b>Welcome back to Canvas LMS Bot!</b>\n\nSelect an option below to fetch your data:");
            } else {
                await sendTelegramMenu(chatId, "Select an option below to fetch your Canvas data:");
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

    let intro = "👋 <b>Welcome to Canvas LMS Bot!</b>";
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

// 5. Privacy Policy Route
app.get('/privacy', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Privacy Policy - Canvas LMS Bot</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }
                h1 { color: #111; }
                h2 { color: #444; margin-top: 30px; }
            </style>
        </head>
        <body>
            <h1>Privacy Policy — Canvas LMS Bot</h1>
            <h2>Data We Collect</h2>
            <p><strong>From Telegram:</strong> We receive your Telegram Chat ID, a unique numeric identifier assigned by Telegram. We do not receive your phone number, contacts, or personal profile data unless shared by you.</p>
            <p><strong>From You:</strong> We collect your Canvas LMS API Access Token, which you voluntarily submit through our registration page.</p>
            <h2>How We Use It</h2>
            <p>Your Chat ID is used solely to identify which Canvas token to use when you request your academic data through Telegram. Your Canvas token is used exclusively to fetch your own academic data (courses, grades, announcements, assignments) from your institution's Canvas LMS on your behalf.</p>
            <h2>Data Retention</h2>
            <p>Canvas tokens are automatically invalidated after 30 days, at which point you will be prompted to re-register. We do not share your data with any third parties.</p>
        </body>
        </html>
    `);
});

// 6. Landing Page
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Canvas LMS Telegram Bot</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #0a0f1e; color: #e8eaf0; min-height: 100vh; overflow-x: hidden; }
        body::before {
            content: ''; position: fixed; top: -50%; left: -50%; width: 200%; height: 200%;
            background: radial-gradient(ellipse at 20% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
                        radial-gradient(ellipse at 80% 80%, rgba(16, 185, 129, 0.1) 0%, transparent 50%);
            animation: gradientShift 8s ease-in-out infinite alternate; z-index: 0;
        }
        @keyframes gradientShift { 0% { transform: translate(0, 0); } 100% { transform: translate(3%, 3%); } }
        .container { position: relative; z-index: 1; max-width: 900px; margin: 0 auto; padding: 60px 24px; }
        .hero { text-align: center; padding: 60px 0 40px; }
        .badge { display: inline-block; background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.4); color: #a5b4fc; font-size: 12px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; padding: 6px 16px; border-radius: 999px; margin-bottom: 28px; }
        h1 { font-size: clamp(2.2rem, 5vw, 3.5rem); font-weight: 800; line-height: 1.15; background: linear-gradient(135deg, #ffffff 0%, #a5b4fc 50%, #34d399 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-bottom: 20px; }
        .subtitle { font-size: 1.15rem; color: #9ca3af; line-height: 1.7; max-width: 620px; margin: 0 auto 40px; }
        .status-pill { display: inline-flex; align-items: center; gap: 8px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; font-size: 13px; font-weight: 600; padding: 8px 20px; border-radius: 999px; }
        .status-dot { width: 8px; height: 8px; background: #34d399; border-radius: 50%; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
        .section-title { font-size: 0.8rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #6366f1; text-align: center; margin: 70px 0 12px; }
        .section-heading { font-size: 1.8rem; font-weight: 700; text-align: center; color: #f1f5f9; margin-bottom: 40px; }
        .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 60px; }
        .feature-card { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 16px; padding: 28px 24px; transition: all 0.3s ease; }
        .feature-card:hover { background: rgba(255, 255, 255, 0.06); border-color: rgba(99, 102, 241, 0.4); transform: translateY(-4px); }
        .feature-icon { font-size: 2rem; margin-bottom: 14px; }
        .feature-card h3 { font-size: 1rem; font-weight: 700; color: #f1f5f9; margin-bottom: 8px; }
        .feature-card p { font-size: 0.875rem; color: #6b7280; line-height: 1.6; }
        .tech-grid { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-bottom: 60px; }
        .tech-tag { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); padding: 8px 18px; border-radius: 999px; font-size: 0.875rem; font-weight: 600; color: #d1d5db; }
        footer { text-align: center; padding: 40px 0 20px; border-top: 1px solid rgba(255,255,255,0.06); color: #4b5563; font-size: 0.8rem; }
        footer a { color: #6366f1; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <section class="hero">
            <div class="badge">🎓 Academic Assistant</div>
            <h1>Canvas LMS<br>Telegram Bot</h1>
            <p class="subtitle">A smart Telegram chatbot that connects directly to your institution's Canvas Learning Management System — bringing your grades, announcements, courses, and assignments straight to your Telegram chat.</p>
            <div class="status-pill"><span class="status-dot"></span>Server Online & Operational</div>
        </section>

        <p class="section-title">What It Does</p>
        <h2 class="section-heading">Your Canvas Dashboard,<br>Right Inside Telegram</h2>

        <div class="features-grid">
            <div class="feature-card"><div class="feature-icon">📢</div><h3>Announcements</h3><p>Get latest course announcements with dates and timestamps.</p></div>
            <div class="feature-card"><div class="feature-icon">📊</div><h3>Grades</h3><p>Instantly view assignment scores across your active courses.</p></div>
            <div class="feature-card"><div class="feature-icon">📚</div><h3>My Courses</h3><p>See a clean list of enrolled courses for the semester.</p></div>
            <div class="feature-card"><div class="feature-icon">📝</div><h3>Assignments</h3><p>Track upcoming deadlines, descriptions, and point values.</p></div>
        </div>

        <p class="section-title">Built With</p>
        <div class="tech-grid">
            <span class="tech-tag">⚡ Node.js</span>
            <span class="tech-tag">🚂 Express.js</span>
            <span class="tech-tag">✈️ Telegram Bot API</span>
            <span class="tech-tag">🎓 Canvas LMS API</span>
            <span class="tech-tag">🐘 Neon PostgreSQL</span>
            <span class="tech-tag">☁️ Render</span>
        </div>

        <footer>
            <p>Canvas LMS Telegram Bot &nbsp;·&nbsp; <a href="/privacy">Privacy Policy</a></p>
        </footer>
    </div>
</body>
</html>`);
});

// HTML Registration Page Template
function getRegistrationHTML(chatId) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connect Canvas LMS</title>
    <style>
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: #f0f2f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 30px; width: 100%; max-width: 420px; }
        h2 { margin-top: 0; color: #1c1e21; text-align: center; }
        p { color: #606770; font-size: 14px; line-height: 1.5; text-align: center; }
        .form-group { margin-top: 20px; }
        label { display: block; font-weight: 600; font-size: 13px; color: #4b4f56; margin-bottom: 8px; }
        input { width: 100%; padding: 12px; border: 2px solid #ccc; border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; }
        input.green { border-color: #2e7d32 !important; background-color: #e8f5e9; }
        input.red { border-color: #d32f2f !important; background-color: #ffebee; }
        .btn { width: 100%; background: #0088cc; color: white; border: none; padding: 12px; font-size: 15px; font-weight: 600; border-radius: 8px; cursor: pointer; margin-top: 20px; transition: background 0.2s; }
        .btn:disabled { background: #bcc0c4; cursor: not-allowed; }
        .status-msg { margin-top: 15px; font-size: 13px; text-align: center; font-weight: 600; }
        .status-msg.success { color: #2e7d32; }
        .status-msg.error { color: #d32f2f; }
    </style>
</head>
<body>
    <div class="card">
        <h2>🎓 Connect Canvas LMS</h2>
        <p>Enter your Canvas Access Token below to connect your Canvas account with Telegram. Tokens expire after 30 days.</p>
        <form id="regForm">
            <input type="hidden" id="psid" value="${chatId}">
            <div class="form-group">
                <label for="token">Canvas API Access Token</label>
                <input type="password" id="token" placeholder="Paste your Canvas token here..." required>
            </div>
            <button type="submit" id="submitBtn" class="btn">Connect Canvas</button>
        </form>
        <div id="statusMsg" class="status-msg"></div>
    </div>

    <script>
        const form = document.getElementById('regForm');
        const tokenInput = document.getElementById('token');
        const submitBtn = document.getElementById('submitBtn');
        const statusMsg = document.getElementById('statusMsg');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const psid = document.getElementById('psid').value;
            const canvas_token = tokenInput.value.trim();

            if (!psid) {
                statusMsg.className = 'status-msg error';
                statusMsg.textContent = 'Invalid link. Please open this link directly from Telegram.';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Validating Token...';
            tokenInput.className = '';
            statusMsg.textContent = '';

            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ psid, canvas_token })
                });

                const data = await res.json();

                if (data.success) {
                    tokenInput.className = 'green';
                    statusMsg.className = 'status-msg success';
                    statusMsg.textContent = '🎉 Connected successfully as ' + data.name + '! You can now close this tab and return to Telegram.';
                    submitBtn.textContent = 'Connected!';
                } else {
                    tokenInput.className = 'red';
                    statusMsg.className = 'status-msg error';
                    statusMsg.textContent = '❌ ' + (data.message || 'Invalid Token');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Try Again';
                }
            } catch (err) {
                tokenInput.className = 'red';
                statusMsg.className = 'status-msg error';
                statusMsg.textContent = 'Network error. Please try again.';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Try Again';
            }
        });
    </script>
</body>
</html>`;
}

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
