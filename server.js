const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

const IKHOKHA_APP_ID = process.env.IKHOKHA_APP_ID;
const IKHOKHA_SECRET = process.env.IKHOKHA_SECRET;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

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
    res.json({ status: '✅ Payment API is running!' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Create payment endpoint
app.post('/create-payment', async (req, res) => {
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
            res.json({ success: false, error: data.message || "Payment creation failed" });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// FORGOT PASSWORD - Send reset email via Brevo
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: "Email required" });
    }
    
    // Generate a reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 3600000; // 1 hour
    
    // Store reset token temporarily (in memory - for demo)
    // In production, you'd use a database
    if (!global.resetTokens) global.resetTokens = {};
    global.resetTokens[email] = { token: resetToken, expires: resetExpires };
    
    // Create reset link
    const resetLink = `https://mryoungfargo.github.io/Duets-merch-store/reset-password.html?token=${resetToken}&email=${encodeURIComponent(email)}`;
    
    // Send email via Brevo
    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': BREVO_API_KEY
            },
            body: JSON.stringify({
                sender: { name: 'MrYoungFargo', email: 'noreply@mryoungfargo.com' },
                to: [{ email: email }],
                subject: 'Reset your MrYoungFargo password',
                htmlContent: `
                    <h2>Password Reset Request</h2>
                    <p>You requested to reset your password for your MrYoungFargo account.</p>
                    <p>Click the link below to create a new password. This link expires in 1 hour.</p>
                    <a href="${resetLink}" style="background:#3b82f6; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">Reset Password</a>
                    <p>If you didn't request this, please ignore this email.</p>
                `
            })
        });
        
        if (response.ok) {
            res.json({ success: true, message: "Reset email sent" });
        } else {
            res.json({ success: false, error: "Failed to send email" });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// RESET PASSWORD - Verify token and update password
app.post('/reset-password', async (req, res) => {
    const { email, token, newPassword } = req.body;
    
    if (!global.resetTokens || !global.resetTokens[email]) {
        return res.json({ success: false, error: "Invalid or expired reset request" });
    }
    
    const resetData = global.resetTokens[email];
    if (resetData.token !== token || resetData.expires < Date.now()) {
        return res.json({ success: false, error: "Invalid or expired reset token" });
    }
    
    // Token is valid - password will be updated on frontend
    delete global.resetTokens[email];
    res.json({ success: true, message: "Password can now be reset" });
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log("💰 Webhook received:", req.body);
    res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
