const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

const IKHOKHA_APP_ID = process.env.IKHOKHA_APP_ID;
const IKHOKHA_SECRET = process.env.IKHOKHA_SECRET;

const API_ENDPOINT = 'https://api.ikhokha.com/public-api/v1/api/payment';

function jsStringEscape(str) {
    return str.replace(/[\\"']/g, '\\$&').replace(/\u0000/g, '\\0');
}

function createPayloadToSign(urlPath, body) {
    const basePath = new URL(urlPath).pathname;
    const payload = basePath + body;
    return jsStringEscape(payload);
}

function generateSignature(payloadToSign, secret) {
    return crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');
}

app.get('/', (req, res) => {
    res.json({ 
        status: '✅ iKhokha Payment API is running!',
        endpoints: { health: 'GET /health', createPayment: 'POST /create-payment' }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/create-payment', async (req, res) => {
    console.log("📦 Received:", req.body);
    
    const { amount, orderId } = req.body;
    
    if (!amount || amount <= 0) {
        return res.json({ success: false, error: "Invalid amount" });
    }
    
    if (!IKHOKHA_APP_ID || !IKHOKHA_SECRET) {
        return res.json({ success: false, error: "API keys not configured" });
    }
    
    const amountInCents = Math.round(amount * 100);
    
    const requestPayload = {
        entityID: IKHOKHA_APP_ID,
        amount: amountInCents,
        currency: "ZAR",
        requesterUrl: "https://mryoungfargo.github.io/Duets-merch-store/",
        mode: "TEST",
        externalTransactionID: orderId || "ORDER_" + Date.now(),
        urls: {
            callbackUrl: "https://mryoungfargo-payment.onrender.com/webhook",
            successPageUrl: "https://mryoungfargo.github.io/Duets-merch-store/success.html",
            failurePageUrl: "https://mryoungfargo.github.io/Duets-merch-store/failed.html",
            cancelUrl: "https://mryoungfargo.github.io/Duets-merch-store/cancel.html"
        }
    };
    
    const requestBodyStr = JSON.stringify(requestPayload);
    const payloadToSign = createPayloadToSign(API_ENDPOINT, requestBodyStr);
    const signature = generateSignature(payloadToSign, IKHOKHA_SECRET);
    
    try {
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'IK-APPID': IKHOKHA_APP_ID,
                'IK-SIGN': signature
            },
            body: requestBodyStr
        });
        
        const data = await response.json();
        
        if (data.paylinkUrl) {
            res.json({ success: true, paymentUrl: data.paylinkUrl });
        } else {
            res.json({ success: false, error: data.message || "Payment creation failed", details: data });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/webhook', (req, res) => {
    console.log("💰 Webhook:", req.body);
    res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
