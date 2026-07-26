import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { Courses, Announcements, Grades } from './messageFormatter.js';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123456';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

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

// Route to manually trigger/update Persistent Menu setup
app.get('/setup-menu', async (req, res) => {
    try {
        await setupPersistentMenu();
        res.send('Persistent Menu configured successfully on Facebook!');
    } catch (error) {
        res.status(500).send(`Error setting up menu: ${error.message}`);
    }
});

// 2. POST /webhook — Receives incoming chat, button clicks & postbacks
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            // Handle Persistent Menu clicks (Postbacks)
            if (webhook_event.postback) {
                const payload = webhook_event.postback.payload;
                console.log(`Persistent Menu clicked payload: ${payload}`);
                await handleOptionSelected(sender_psid, payload);
            }
            // Handle Quick Replies or typed messages
            else if (webhook_event.message) {
                if (webhook_event.message.quick_reply) {
                    const payload = webhook_event.message.quick_reply.payload;
                    console.log(`Quick Reply clicked payload: ${payload}`);
                    await handleOptionSelected(sender_psid, payload);
                } 
                else if (webhook_event.message.text) {
                    await sendQuickReplyMenu(sender_psid, "Welcome to Canvas LMS! Select an option below or use the chat menu:");
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
});

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

// Handle option selection by fetching REAL Canvas data from canvasService.js!
async function handleOptionSelected(senderPsid, payload) {
    let responseText = "";

    try {
        switch (payload) {
            case "GET_ANNOUNCEMENTS": {
                responseText = await Announcements();
                break;
            }
            case "GET_GRADES": {
                responseText = await Grades();
                break;
            }
            case "GET_COURSES": {
                responseText = await Courses();
                break;
            }
            default:
                responseText = "I didn't understand that option.";
        }
    } catch (err) {
        console.error("Canvas Service Error:", err.message);
        responseText = "⚠️ Unable to fetch data from Canvas right now. Please verify CANVAS_BASE_URL and CANVAS_API_TOKEN in your .env / Render environment variables.";
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

app.get('/', (req, res) => {
    res.send('Messenger Bot Server is running!');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    if (PAGE_ACCESS_TOKEN) {
        setupPersistentMenu();
    }
});
