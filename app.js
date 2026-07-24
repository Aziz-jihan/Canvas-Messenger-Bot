import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123456';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

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

// 2. POST /webhook — Receives incoming chat & button clicks
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id;

            // Check if the user clicked a Quick Reply button OR typed a message
            if (webhook_event.message) {
                // If user clicked a Quick Reply button
                if (webhook_event.message.quick_reply) {
                    const payload = webhook_event.message.quick_reply.payload;
                    console.log(`User clicked button payload: ${payload}`);
                    await handleQuickReply(sender_psid, payload);
                } 
                // If user typed a text message
                else if (webhook_event.message.text) {
                    // Send main menu with clickable buttons
                    await sendQuickReplyMenu(sender_psid);
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// Helper 1: Send Main Menu with Clickable Options
async function sendQuickReplyMenu(senderPsid) {
    const requestBody = {
        recipient: { id: senderPsid },
        message: {
            text: "Welcome to Canvas LMS! What would you like to check?",
            quick_replies: [
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
            ]
        }
    };
    await callSendAPI(requestBody);
}

// Helper 2: Handle button clicks based on payload
async function handleQuickReply(senderPsid, payload) {
    let responseText = "";

    switch (payload) {
        case "GET_ANNOUNCEMENTS":
            responseText = "📢 Here are your latest Canvas Announcements:\n\n• Exam 1 results posted\n• Homework 2 due this Friday";
            break;
        case "GET_GRADES":
            responseText = "📊 Canvas Grades Summary:\n\n• Web Development: 95%\n• Database Systems: 88%";
            break;
        case "GET_COURSES":
            responseText = "📚 Enrolled Courses:\n\n1. CS101: Intro to Web Development\n2. CS202: Database Architecture";
            break;
        default:
            responseText = "I didn't understand that option.";
    }

    // Send answer back
    await callSendAPI({ recipient: { id: senderPsid }, message: { text: responseText } });
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
});
