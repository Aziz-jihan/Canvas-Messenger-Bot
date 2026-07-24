import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123456';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

// 1. GET /webhook — Verification endpoint required by Facebook
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
        console.log('Missing mode or verify token in the request');
        return res.status(400).send('Missing mode or verify token');
    }
});

// 2. POST /webhook — Receives incoming chat messages from Facebook
app.post('/webhook', async (req, res) => {
    console.log('Received webhook event:', JSON.stringify(req.body, null, 2));

    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

         for (const entry of body.entry) {
            const webhook_event = entry.messaging[0];
            const sender_psid = webhook_event.sender.id; // User's unique ID
            if (webhook_event.message && webhook_event.message.text) {
                const text = webhook_event.message.text.toLowerCase();
                console.log(`Received message: "${text}" from ${sender_psid}`);
                // Reply to user
                await sendTextMessage(sender_psid, `wassup!!! I am your Canvas LMS Assistant. You said: "${webhook_event.message.text}"`);
            }
        }
    }else {
        res.sendStatus(404);
    }
});


async function sendTextMessage(senderPsid, responseText) {
    const requestBody = {
        recipient: { id: senderPsid },
        message: { text: responseText }
    };
    try {
        await axios.post(
            `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
            requestBody
        );
        console.log('Successfully sent message back to user!');
    } catch (error) {
        console.error('Error sending message:', error.response ? error.response.data : error.message);
    }
}

// Root route for sanity check
app.get('/', (req, res) => {
    res.send('Messenger Bot Server is running!');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
