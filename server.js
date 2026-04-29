const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

const IKHOKHA_APP_ID = process.env.IK46NDKL1J3S4VJWO7XXCRD4F8P3KQAN;
const IKHOKHA_SECRET = process.env.pe09mzC6QwkaQGMA72CVq9SeAvtsXoxK;

console.log("🔑 App ID loaded:", IKHOKHA_APP_ID ? "✅ Yes" : "❌ Missing");
console.log("🔑 Secret loaded:", IKHOKHA_SECRET ? "✅ Yes" : "❌ Missing");

function generateSignature(payload, secret) {
    const stringToSign = JSON.stringify(payload) + secret;
    return crypto.createHash('sha256').update(stringToSign).digest('hex');
}

app.get('/', (req, res) => {
    res.json({
        status: '✅ Payment API is running!',
        appIdLoaded: !!IKHOKHA_APP_ID,
        secretLoaded: !!IKHOKHA_SECRET
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        appIdLoaded: !!IKHOKHA_APP_ID
    });
});

app.post('/create-payment', async (req, res) => {
    console.log("📦 Received request:", req.body);
    
    const { amount, orderId, customerEmail } = req.body;
    
    if (!amount || amount <= 0) {
        return res.json({ success: false, error: "Invalid amount" });
    }
    
    if (!IKHOKHA_APP_ID || !IKHOKHA_SECRET) {
        return res.json({ success: false, error: "API keys not configured on server" });
    }
    
    const amountInCents = Math.round(amount * 100);
    
    const payload = {
        amount: amountInCents,
        currency: "ZAR",
        transactionType: "SALE",
        merchantOrderID: orderId || "ORDER_" + Date.now(),
        customerEmail: customerEmail || "customer@example.com",
        returnUrl: "https://mryoungfargo.github.io/Duets-merch-store/success.html",
        cancelUrl: "https://mryoungfargo.github.io/Duets-merch-store/cancel.html",
        notifyUrl: "https://mryoungfargo-payment.onrender.com/webhook"
    };
    
    const signature = generateSignature(payload, IKHOKHA_SECRET);
    
    try {
        console.log("📤 Sending to iKhokha...");
        const response = await fetch('https://sandbox.ikhokha.com/v1/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Application-Id': IKHOKHA_APP_ID,
                'X-Signature': signature
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        console.log("iKhokha response:", data);
        
        if (data.paymentUrl) {
            res.json({ success: true, paymentUrl: data.paymentUrl });
        } else {
            res.json({ success: false, error: data.message || "Payment creation failed" });
        }
    } catch (error) {
        console.error("Error:", error.message);
        res.json({ success: false, error: error.message });
    }
});

app.post('/webhook', (req, res) => {
    console.log("💰 Webhook received:", req.body);
    res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
