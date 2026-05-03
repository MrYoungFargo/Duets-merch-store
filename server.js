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

// Simple in-memory user storage (for demo - use a real database in production)
// For a real store, use MongoDB, PostgreSQL, or a similar database
let users = []; // This will reset on server restart

// Load users from a file if it exists (simple persistence)
const fs = require('fs');
const USERS_FILE = './users.json';
try {
  if (fs.existsSync(USERS_FILE)) {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    users = JSON.parse(data);
    console.log(`Loaded ${users.length} users from file`);
  }
} catch (err) {
  console.log('No existing users file, starting fresh');
}

function saveUsersToFile() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    console.log(`Saved ${users.length} users to file`);
  } catch (err) {
    console.error('Error saving users:', err);
  }
}

// Simple password hashing (for demo - use bcrypt in production)
function hashPassword(password, salt = null) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
  const hash = crypto.createHmac('sha256', salt).update(password).digest('hex');
  return hash === storedHash;
}

// ==============================================================
// USER AUTHENTICATION ENDPOINTS
// ==============================================================

// Register a new user
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.json({ success: false, error: 'Email and password required' });
  }
  
  if (users.find(u => u.email === email)) {
    return res.json({ success: false, error: 'Email already registered' });
  }
  
  const { salt, hash } = hashPassword(password);
  const newUser = { 
    email, 
    passwordHash: hash, 
    salt, 
    cart: [],
    hasPurchasedMixtape: false,
    createdAt: new Date().toISOString()
  };
  
  users.push(newUser);
  saveUsersToFile();
  
  res.json({ 
    success: true, 
    user: { email: newUser.email, cart: newUser.cart, hasPurchasedMixtape: newUser.hasPurchasedMixtape }
  });
});

// Login a user
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.json({ success: false, error: 'Email and password required' });
  }
  
  const user = users.find(u => u.email === email);
  if (!user) {
    return res.json({ success: false, error: 'Invalid email or password' });
  }
  
  if (!verifyPassword(password, user.salt, user.passwordHash)) {
    return res.json({ success: false, error: 'Invalid email or password' });
  }
  
  // Generate a session token (simple for now - use JWT in production)
  const sessionToken = crypto.randomBytes(32).toString('hex');
  user.sessionToken = sessionToken;
  user.lastLogin = new Date().toISOString();
  saveUsersToFile();
  
  res.json({ 
    success: true, 
    sessionToken: sessionToken,
    user: { email: user.email, cart: user.cart, hasPurchasedMixtape: user.hasPurchasedMixtape }
  });
});

// Verify session token and get user data
app.post('/api/verify', (req, res) => {
  const { sessionToken } = req.body;
  
  if (!sessionToken) {
    return res.json({ success: false, error: 'No session token' });
  }
  
  const user = users.find(u => u.sessionToken === sessionToken);
  if (!user) {
    return res.json({ success: false, error: 'Invalid session' });
  }
  
  res.json({ 
    success: true, 
    user: { email: user.email, cart: user.cart, hasPurchasedMixtape: user.hasPurchasedMixtape }
  });
});

// Update user's cart
app.post('/api/update-cart', (req, res) => {
  const { sessionToken, cart } = req.body;
  
  if (!sessionToken) {
    return res.json({ success: false, error: 'No session token' });
  }
  
  const user = users.find(u => u.sessionToken === sessionToken);
  if (!user) {
    return res.json({ success: false, error: 'Invalid session' });
  }
  
  user.cart = cart;
  saveUsersToFile();
  
  res.json({ success: true });
});

// Mark mixtape as purchased
app.post('/api/mark-mixtape', (req, res) => {
  const { sessionToken } = req.body;
  
  if (!sessionToken) {
    return res.json({ success: false, error: 'No session token' });
  }
  
  const user = users.find(u => u.sessionToken === sessionToken);
  if (!user) {
    return res.json({ success: false, error: 'Invalid session' });
  }
  
  user.hasPurchasedMixtape = true;
  saveUsersToFile();
  
  res.json({ success: true });
});

// Logout
app.post('/api/logout', (req, res) => {
  const { sessionToken } = req.body;
  
  if (sessionToken) {
    const user = users.find(u => u.sessionToken === sessionToken);
    if (user) {
      delete user.sessionToken;
      saveUsersToFile();
    }
  }
  
  res.json({ success: true });
});

// ==============================================================
// iKHOKHA PAYMENT ENDPOINTS
// ==============================================================

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
    res.json({ status: '✅ Payment API is running!', users: users.length });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

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
        requesterUrl: "https://mryoungfargo.github.io/Mryoungfargo/",
        mode: "TEST",
        externalTransactionID: orderId || "ORDER_" + Date.now(),
        urls: {
            callbackUrl: "https://mryoungfargo-payment.onrender.com/webhook",
            successPageUrl: "https://mryoungfargo.github.io/Mryoungfargo/success.html",
            failurePageUrl: "https://mryoungfargo.github.io/Mryoungfargo/failed.html",
            cancelUrl: "https://mryoungfargo.github.io/Mryoungfargo/cancel.html"
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

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.json({ success: false, error: "Email required" });
    }
    
    const user = users.find(u => u.email === email);
    if (!user) {
        return res.json({ success: false, error: "Email not found" });
    }
    
    if (!BREVO_API_KEY) {
        return res.json({ success: false, error: "Email service not configured" });
    }
    
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = Date.now() + 3600000;
    
    user.resetToken = resetToken;
    user.resetExpires = resetExpires;
    saveUsersToFile();
    
    const resetLink = `https://mryoungfargo.github.io/Mryoungfargo/reset-password.html?token=${resetToken}&email=${encodeURIComponent(email)}`;
    
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
                    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #1a1a2e; color: #e0e0e0; border-radius: 10px;">
                        <h2 style="color: #3b82f6;">Reset Your Password</h2>
                        <p>Click the button below to create a new password. This link expires in 1 hour.</p>
                        <a href="${resetLink}" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Reset Password</a>
                        <p style="font-size: 12px; color: #888;">If you didn't request this, please ignore this email.</p>
                    </div>
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

app.post('/reset-password', (req, res) => {
    const { email, token, newPassword } = req.body;
    
    const user = users.find(u => u.email === email);
    if (!user || user.resetToken !== token || user.resetExpires < Date.now()) {
        return res.json({ success: false, error: "Invalid or expired reset token" });
    }
    
    const { salt, hash } = hashPassword(newPassword);
    user.passwordHash = hash;
    user.salt = salt;
    delete user.resetToken;
    delete user.resetExpires;
    saveUsersToFile();
    
    res.json({ success: true, message: "Password reset successfully" });
});

app.post('/webhook', (req, res) => {
    console.log("💰 Webhook received:", req.body);
    res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📧 Brevo API Key configured: ${BREVO_API_KEY ? '✅ Yes' : '❌ No'}`);
});
