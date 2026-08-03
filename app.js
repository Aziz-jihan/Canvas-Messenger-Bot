import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { Courses, Announcements, Grades, Assignments } from './messageFormatter.js';
import { validateToken } from './canvasService.js';
import { getUser, saveUser, isTokenValid } from './userService.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123456';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const APP_URL = process.env.APP_URL;
if (!APP_URL) {
    console.error('FATAL: APP_URL environment variable is not set! Registration links will not work.');
}

// Standard Quick Replies Array
const MENU_QUICK_REPLIES = [
    {
        content_type: "text",
        title: "📢 Announcements",
        payload: "GET_ANNOUNCEMENTS"
    },
    {
        content_type: "text",
        title: "📊 Grades",
        payload: "GET_GRADES"
    },
    {
        content_type: "text", 
        title: "📚 My Courses",
        payload: "GET_COURSES"
    },
    {
        content_type: "text",
        title: "📝 Assignments",
        payload: "GET_ASSIGNMENT"
    }
];

// 1. GET /webhook — Verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED!');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    } else {
        return res.status(400).send('Missing mode or verify token');
    }
});

// 2. GET /register — Serves the Registration Form
app.get('/register', (req, res) => {
    const psid = req.query.psid || '';
    res.send(getRegistrationHTML(psid));
});

// 3. POST /api/register — Validates Canvas Token & Saves to Neon DB
app.post('/api/register', async (req, res) => {
    const { psid, canvas_token } = req.body;

    if (!psid || !canvas_token) {
        return res.status(400).json({ success: false, message: 'Missing PSID or Canvas Token' });
    }

    console.log(`Validating Canvas Token for PSID: ${psid}...`);
    const validation = await validateToken(canvas_token.trim());

    if (!validation.valid) {
        return res.json({ success: false, message: validation.error || 'Invalid Canvas Access Token' });
    }

    try {
        // Save token to Neon DB
        await saveUser(psid, canvas_token.trim());

        // Send a welcome message directly in Messenger!
        const studentName = validation.user?.name ? `, ${validation.user.name}` : '';
        await sendQuickReplyMenu(
            psid,
            `🎉 Welcome to Canvas LMS Bot${studentName}!\n\nYour account has been connected successfully. Your token is valid for 30 days. Use the menu below to explore your Canvas data:`
        );

        return res.json({ success: true, name: validation.user?.name || 'Student' });
    } catch (err) {
        console.error('Failed to register user:', err.message);
        return res.status(500).json({ success: false, message: 'Database error saving token' });
    }
});

// Route to manually trigger/update Persistent Menu setup
app.get('/setup-menu', async (req, res) => {
    try {
        await setupPersistentMenu();
        res.send('Persistent Menu configured successfully on Facebook!');
    } catch (error) {
        res.status(500).send(`Error setting up menu: ${error.message}`);
    }
});

// 4. POST /webhook — Receives incoming chat, button clicks & postbacks
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const webhook_event = entry.messaging ? entry.messaging[0] : null;
            if (!webhook_event) continue;

            // CRITICAL: Ignore delivery receipts, read receipts, and bot's own message echoes
            // Without this, every message the bot sends triggers another webhook event = infinite loop!
            if (webhook_event.delivery || webhook_event.read || webhook_event.message?.is_echo) {
                continue;
            }

            const sender_psid = webhook_event.sender?.id;
            if (!sender_psid) continue;

            // Check if user is registered and has a valid (< 30 days) token
            const user = await getUser(sender_psid);
            const valid = isTokenValid(user);

            if (!valid) {
                await sendRegistrationLink(sender_psid, user ? 'expired' : 'new');
                continue;
            }

            // Handle Persistent Menu clicks (Postbacks)
            if (webhook_event.postback) {
                const payload = webhook_event.postback.payload;
                console.log(`Persistent Menu clicked payload: ${payload}`);
                await handleOptionSelected(sender_psid, payload, user.canvas_token);
            }
            // Handle Quick Replies or typed messages
            else if (webhook_event.message) {
                if (webhook_event.message.quick_reply) {
                    const payload = webhook_event.message.quick_reply.payload;
                    console.log(`Quick Reply clicked payload: ${payload}`);
                    await handleOptionSelected(sender_psid, payload, user.canvas_token);
                } 
                else if (webhook_event.message.text) {
                    await sendQuickReplyMenu(sender_psid, "Select an option below or use the chat menu:");
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// to get verified privacy policy page for Facebook Messenger
app.get('/privacy', (req, res) => {
    res.send(`
        <h1>Privacy Policy</h1>
        <p>This bot collects only your Canvas API Access Token to retrieve your personal academic data from Canvas LMS. 
        Your token is stored securely and is never shared with third parties. 
        Tokens automatically expire after 30 days.</p>
    `);
});

// Send Registration Link to unregistered or expired users
async function sendRegistrationLink(senderPsid, status) {
    if (!APP_URL) {
        console.error('Cannot send registration link: APP_URL environment variable is not set on Render.');
        return;
    }
    const registerUrl = `${APP_URL}/register?psid=${senderPsid}`;
    let intro = "👋 Welcome to Canvas LMS Bot!";
    if (status === 'expired') {
        intro = "⚠️ Your Canvas token has expired (tokens are valid for 30 days).";
    }

    const messageText = `${intro}\n\nPlease click the link below to connect your Canvas account:\n\n${registerUrl}`;
    
    await callSendAPI({
        recipient: { id: senderPsid },
        message: { text: messageText }
    });
}

// Setup Facebook Messenger Persistent Menu (Pinned 24/7 in chat bar)
async function setupPersistentMenu() {
    const requestBody = {
        persistent_menu: [
            {
                locale: "default",
                composer_input_disabled: false,
                call_to_actions: [
                    {
                        type: "postback",
                        title: "📢 Announcements",
                        payload: "GET_ANNOUNCEMENTS"
                    },
                    {
                        type: "postback",
                        title: "📊 Grades",
                        payload: "GET_GRADES"
                    },
                    {
                        type: "postback",
                        title: "📚 My Courses",
                        payload: "GET_COURSES"
                    },
                    {
                        type: "postback",
                        title: "📝 Assignments",
                        payload: "GET_ASSIGNMENT"
                    }
                ]
            }
        ]
    };

    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`,
            requestBody
        );
        console.log('Persistent Menu configured successfully on Meta Graph API!');
    } catch (error) {
        console.error('Error configuring Persistent Menu:', error.response ? error.response.data : error.message);
    }
}

// Send Quick Reply Menu
async function sendQuickReplyMenu(senderPsid, textMessage) {
    const requestBody = {
        recipient: { id: senderPsid },
        message: {
            text: textMessage,
            quick_replies: MENU_QUICK_REPLIES
        }
    };
    await callSendAPI(requestBody);
}

// Handle option selection by fetching REAL Canvas data for specific user token
async function handleOptionSelected(senderPsid, payload, canvasToken) {
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

    await sendQuickReplyMenu(senderPsid, responseText);
}

// Low-level helper to send request to Facebook Graph API
async function callSendAPI(requestBody) {
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            requestBody
        );
        console.log('Successfully sent message/menu!');
    } catch (error) {
        console.error('Error sending message:', error.response ? error.response.data : error.message);
    }
}

// HTML Registration Page Template
function getRegistrationHTML(psid) {
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
        .btn { width: 100%; background: #0084ff; color: white; border: none; padding: 12px; font-size: 15px; font-weight: 600; border-radius: 8px; cursor: pointer; margin-top: 20px; transition: background 0.2s; }
        .btn:disabled { background: #bcc0c4; cursor: not-allowed; }
        .status-msg { margin-top: 15px; font-size: 13px; text-align: center; font-weight: 600; }
        .status-msg.success { color: #2e7d32; }
        .status-msg.error { color: #d32f2f; }
    </style>
</head>
<body>
    <div class="card">
        <h2>🎓 Connect Canvas LMS</h2>
        <p>Enter your Canvas Access Token below to connect your Canvas account with Messenger. Tokens expire after 30 days.</p>
        <form id="regForm">
            <input type="hidden" id="psid" value="${psid}">
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
                statusMsg.textContent = 'Invalid link. Please open this link directly from Messenger.';
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
                    statusMsg.textContent = '🎉 Connected successfully as ' + data.name + '! You can now close this tab and return to Messenger.';
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

app.get('/', (req, res) => {
    res.send('Messenger Bot Server is running!');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    if (PAGE_ACCESS_TOKEN) {
        setupPersistentMenu();
    }
});
