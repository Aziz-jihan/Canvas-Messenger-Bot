import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '123456';

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
app.post('/webhook', (req, res) => {
    console.log('Received webhook event:', JSON.stringify(req.body, null, 2));
    res.status(200).send('EVENT_RECEIVED');
});

// Root route for sanity check
app.get('/', (req, res) => {
    res.send('Messenger Bot Server is running!');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
