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
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Canvas LMS Messenger Bot</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: 'Inter', sans-serif;
            background: #0a0f1e;
            color: #e8eaf0;
            min-height: 100vh;
            overflow-x: hidden;
        }

        /* Animated gradient background */
        body::before {
            content: '';
            position: fixed;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(ellipse at 20% 20%, rgba(99, 102, 241, 0.15) 0%, transparent 50%),
                        radial-gradient(ellipse at 80% 80%, rgba(16, 185, 129, 0.1) 0%, transparent 50%);
            animation: gradientShift 8s ease-in-out infinite alternate;
            z-index: 0;
        }

        @keyframes gradientShift {
            0% { transform: translate(0, 0); }
            100% { transform: translate(3%, 3%); }
        }

        .container {
            position: relative;
            z-index: 1;
            max-width: 900px;
            margin: 0 auto;
            padding: 60px 24px;
        }

        /* Hero */
        .hero {
            text-align: center;
            padding: 60px 0 40px;
        }

        .badge {
            display: inline-block;
            background: rgba(99, 102, 241, 0.15);
            border: 1px solid rgba(99, 102, 241, 0.4);
            color: #a5b4fc;
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            padding: 6px 16px;
            border-radius: 999px;
            margin-bottom: 28px;
        }

        h1 {
            font-size: clamp(2.2rem, 5vw, 3.5rem);
            font-weight: 800;
            line-height: 1.15;
            background: linear-gradient(135deg, #ffffff 0%, #a5b4fc 50%, #34d399 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 20px;
        }

        .subtitle {
            font-size: 1.15rem;
            color: #9ca3af;
            line-height: 1.7;
            max-width: 620px;
            margin: 0 auto 40px;
        }

        .status-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.3);
            color: #34d399;
            font-size: 13px;
            font-weight: 600;
            padding: 8px 20px;
            border-radius: 999px;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            background: #34d399;
            border-radius: 50%;
            animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.8); }
        }

        /* Features Grid */
        .section-title {
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            color: #6366f1;
            text-align: center;
            margin: 70px 0 12px;
        }

        .section-heading {
            font-size: 1.8rem;
            font-weight: 700;
            text-align: center;
            color: #f1f5f9;
            margin-bottom: 40px;
        }

        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 60px;
        }

        .feature-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 16px;
            padding: 28px 24px;
            transition: all 0.3s ease;
            cursor: default;
        }

        .feature-card:hover {
            background: rgba(255, 255, 255, 0.06);
            border-color: rgba(99, 102, 241, 0.4);
            transform: translateY(-4px);
        }

        .feature-icon {
            font-size: 2rem;
            margin-bottom: 14px;
        }

        .feature-card h3 {
            font-size: 1rem;
            font-weight: 700;
            color: #f1f5f9;
            margin-bottom: 8px;
        }

        .feature-card p {
            font-size: 0.875rem;
            color: #6b7280;
            line-height: 1.6;
        }

        /* How it works */
        .steps {
            display: flex;
            flex-direction: column;
            gap: 0;
            margin-bottom: 60px;
            position: relative;
        }

        .steps::before {
            content: '';
            position: absolute;
            left: 22px;
            top: 24px;
            bottom: 24px;
            width: 2px;
            background: linear-gradient(to bottom, #6366f1, #34d399);
            border-radius: 2px;
        }

        .step {
            display: flex;
            gap: 20px;
            padding: 20px 0;
        }

        .step-number {
            width: 44px;
            height: 44px;
            min-width: 44px;
            background: linear-gradient(135deg, #6366f1, #818cf8);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 0.9rem;
            color: white;
            position: relative;
            z-index: 1;
            box-shadow: 0 0 20px rgba(99, 102, 241, 0.4);
        }

        .step-content h4 {
            font-size: 1rem;
            font-weight: 700;
            color: #f1f5f9;
            margin-bottom: 4px;
            padding-top: 10px;
        }

        .step-content p {
            font-size: 0.875rem;
            color: #6b7280;
            line-height: 1.6;
        }

        /* Tech Stack */
        .tech-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            justify-content: center;
            margin-bottom: 60px;
        }

        .tech-tag {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.1);
            padding: 8px 18px;
            border-radius: 999px;
            font-size: 0.875rem;
            font-weight: 600;
            color: #d1d5db;
            transition: all 0.2s;
        }

        .tech-tag:hover {
            border-color: rgba(99, 102, 241, 0.5);
            color: #a5b4fc;
        }

        /* Footer */
        footer {
            text-align: center;
            padding: 40px 0 20px;
            border-top: 1px solid rgba(255,255,255,0.06);
            color: #4b5563;
            font-size: 0.8rem;
        }

        footer a {
            color: #6366f1;
            text-decoration: none;
        }

        footer a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">

        <!-- Hero -->
        <section class="hero">
            <div class="badge">🎓 Academic Assistant</div>
            <h1>Canvas LMS<br>Messenger Bot</h1>
            <p class="subtitle">
                A smart Facebook Messenger chatbot that connects directly to your institution's 
                Canvas Learning Management System — bringing your grades, announcements, 
                courses, and assignments straight to your chat window.
            </p>
            <div class="status-pill">
                <span class="status-dot"></span>
                Server Online & Operational
            </div>
        </section>

        <!-- What It Does -->
        <p class="section-title">What It Does</p>
        <h2 class="section-heading">Your Canvas Dashboard,<br>Right Inside Messenger</h2>

        <div class="features-grid">
            <div class="feature-card">
                <div class="feature-icon">📢</div>
                <h3>Announcements</h3>
                <p>Get the latest course announcements from all your enrolled courses, with dates and timestamps.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">📊</div>
                <h3>Grades</h3>
                <p>Instantly view your graded assignment scores across all your courses without logging into Canvas.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">📚</div>
                <h3>My Courses</h3>
                <p>See a clean list of all the courses you are currently enrolled in this semester.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">📝</div>
                <h3>Assignments</h3>
                <p>Track upcoming assignment deadlines, descriptions, and point values — all in one message.</p>
            </div>
        </div>

        <!-- How It Works -->
        <p class="section-title">How It Works</p>
        <h2 class="section-heading">Simple 3-Step Setup</h2>

        <div class="steps">
            <div class="step">
                <div class="step-number">1</div>
                <div class="step-content">
                    <h4>Message the Facebook Page</h4>
                    <p>Send any message to our Facebook Page on Messenger. The bot responds immediately with a secure registration link personalized to your account.</p>
                </div>
            </div>
            <div class="step">
                <div class="step-number">2</div>
                <div class="step-content">
                    <h4>Connect Your Canvas Account</h4>
                    <p>Open the link in your browser and paste your Canvas API Access Token. The bot validates it in real-time — the form turns green on success, red if the token is invalid.</p>
                </div>
            </div>
            <div class="step">
                <div class="step-number">3</div>
                <div class="step-content">
                    <h4>Start Using the Bot</h4>
                    <p>Once connected, you receive a welcome message with interactive buttons directly in Messenger. Tap any option to instantly fetch your live Canvas data.</p>
                </div>
            </div>
        </div>

        <!-- Tech Stack -->
        <p class="section-title">Built With</p>
        <h2 class="section-heading">Modern, Reliable Technology</h2>

        <div class="tech-grid">
            <span class="tech-tag">⚡ Node.js</span>
            <span class="tech-tag">🚂 Express.js</span>
            <span class="tech-tag">📡 Meta Messenger API</span>
            <span class="tech-tag">🎓 Canvas LMS API</span>
            <span class="tech-tag">🔷 Axios</span>
            <span class="tech-tag">🐘 Neon PostgreSQL</span>
            <span class="tech-tag">☁️ Render</span>
        </div>

        <!-- Footer -->
        <footer>
            <p>Canvas LMS Messenger Bot &nbsp;·&nbsp; <a href="/privacy">Privacy Policy</a></p>
            <p style="margin-top:8px;">Token-based authentication · Data never shared · Tokens expire after 30 days</p>
        </footer>

    </div>
</body>
</html>`);
});


app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    if (PAGE_ACCESS_TOKEN) {
        setupPersistentMenu();
    }
});
