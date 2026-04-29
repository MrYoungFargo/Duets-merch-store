require('dotenv').config();  // Add this at the very topconst express = require('express');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

// Allow all origins for testing
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Your iKhokha credentials – set these in Render dashboard
const IKHOKHA_APP_ID = process.env.IKHOKHA_APP_ID;
const IKHOKHA_SECRET = process.env.IKHOKHA_SECRET;

// Generate signature for iKhokha
function generateSignature(payload, secret) {
    const stringToSign = JSON.stringify(payload) + secret;
    return crypto.createHash('sha256').update(stringToSign).digest('hex');
}

// ROOT ROUTE
app.get('/', (req, res) => {
    res.json({
        status: '✅ Payment API is running!',
        message: 'MrYoungFargo store backend is active',
        endpoints: {
            health: 'GET /health',
            createPayment: 'POST /create-payment',
            webhook: 'POST /webhook'
        }
    });
});

// HEALTH CHECK ENDPOINT – THIS FIXES THE 404!
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'MrYoungFargo Payment Backend'
    });
});

// Create payment endpoint
app.post('/create-payment', async (req, res) => {
    console.log("📦 Received request:", req.body);
    
    const { amount, orderId, customerEmail } = req.body;
    
    if (!amount || amount <= 0) {
        return res.json({ success: false, error: "Invalid amount" });
    }
    
    const amountInCents = Math.round(amount * 100);
    
    const payload = {
        amount: amountInCents,
        currency: "ZAR",
        mode: "TEST",
        transactionType: "SALE",
        merchantOrderID: orderId || "ORDER_" + Date.now(),
        customerEmail: customerEmail || "customer@example.com",
        returnUrl: "https://mryoungfargo.github.io/Duets-merch-store/success.html",
        cancelUrl: "https://mryoungfargo.github.io/Duets-merch-store/cancel.html",
        notifyUrl: "https://mryoungfargo-payment.onrender.com/webhook"
    };
    
    const signature = generateSignature(payload, IKHOKHA_SECRET);
    
    try {
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

// Webhook for payment confirmation
app.post('/webhook', (req, res) => {
    console.log("💰 Webhook received:", req.body);
    res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
