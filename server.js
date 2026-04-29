const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

app.use(cors());
app.use(express.json());

// Your iKhokha credentials (set in Render environment variables)
const IKHOKHA_APP_ID = process.env.IK46NDKL1J3S4VJWO7XXCRD4F8P3KQAN;
const IKHOKHA_SECRET = process.env.pe09mzC6QwkaQGMA72CVq9SeAvtsXoxK;

// Generate signature for iKhokha API
function generateSignature(payload, secret) {
    const stringToSign = JSON.stringify(payload) + secret;
    return crypto.createHash('sha256').update(stringToSign).digest('hex');
}

// Create payment endpoint
app.post('/create-payment', async (req, res) => {
    const { amount, orderId, customerEmail } = req.body;
    const amountInCents = Math.round(amount * 100);
    
    const payload = {
        amount: amountInCents,
        currency: "ZAR",
        mode: "TEST",  // Use "PRODUCTION" for live payments
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
        
        if (data.paymentUrl) {
            res.json({ success: true, paymentUrl: data.paymentUrl });
        } else {
            res.json({ success: false, error: data.message || "Payment creation failed" });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Webhook endpoint for payment confirmation
app.post('/webhook', (req, res) => {
    console.log("Webhook received:", req.body);
    res.status(200).send("OK");
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Default route – fix for 404
app.get('/', (req, res) => {
    res.json({ 
        message: 'MrYoungFargo Payment API is running',
        endpoints: ['/create-payment', '/webhook', '/health']
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
