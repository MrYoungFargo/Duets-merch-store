const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

// ==============================================================
// ENVIRONMENT VARIABLES (set these in Render)
// ==============================================================
const IKHOKHA_APP_ID = process.env.IKHOKHA_APP_ID;
const IKHOKHA_SECRET = process.env.IKHOKHA_SECRET;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ==============================================================
// SUPABASE ADMIN CLIENT (for backend operations)
// ==============================================================
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// In-memory session storage (consider using a database for production)
global.sessions = new Map();
global.resetTokens = {};

// ==============================================================
// HELPER: Get or create user_store_data row
// ==============================================================
async function getUserStoreData(userId) {
  let { data, error } = await supabaseAdmin
    .from('user_store_data')
    .select('*')
    .eq('id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    const { data: newData, error: insertError } = await supabaseAdmin
      .from('user_store_data')
      .insert([{ id: userId, cart: [], has_purchased_mixtape: false }])
      .select()
      .single();
    if (insertError) throw insertError;
    return newData;
  }
  if (error) throw error;
  return data;
}

// ==============================================================
// HEALTH CHECK ENDPOINT
// ==============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ==============================================================
// REGISTER ENDPOINT
// ==============================================================
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ success: false, error: 'Email and password required' });
  }

  try {
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) throw authError;

    const storeData = await getUserStoreData(authUser.user.id);

    res.json({
      success: true,
      user: {
        email: authUser.user.email,
        cart: storeData.cart || [],
        hasPurchasedMixtape: storeData.has_purchased_mixtape || false
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.json({ success: false, error: error.message || 'Registration failed' });
  }
});

// ==============================================================
// LOGIN ENDPOINT
// ==============================================================
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ success: false, error: 'Email and password required' });
  }

  try {
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const user = users.find(u => u.email === email);
    if (!user) {
      return res.json({ success: false, error: 'Invalid email or password' });
    }

    // Generate session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    global.sessions.set(sessionToken, { userId: user.id, email: user.email });

    const storeData = await getUserStoreData(user.id);

    res.json({
      success: true,
      sessionToken,
      user: {
        email: user.email,
        cart: storeData.cart || [],
        hasPurchasedMixtape: storeData.has_purchased_mixtape || false
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, error: error.message || 'Login failed' });
  }
});

// ==============================================================
// VERIFY SESSION ENDPOINT
// ==============================================================
app.post('/api/verify', async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken || !global.sessions.has(sessionToken)) {
    return res.json({ success: false, error: 'Invalid session' });
  }

  const session = global.sessions.get(sessionToken);
  try {
    const storeData = await getUserStoreData(session.userId);
    res.json({
      success: true,
      user: {
        email: session.email,
        cart: storeData.cart || [],
        hasPurchasedMixtape: storeData.has_purchased_mixtape || false
      }
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==============================================================
// UPDATE CART ENDPOINT
// ==============================================================
app.post('/api/update-cart', async (req, res) => {
  const { sessionToken, cart } = req.body;
  if (!sessionToken || !global.sessions.has(sessionToken)) {
    return res.json({ success: false, error: 'Invalid session' });
  }

  const session = global.sessions.get(sessionToken);
  try {
    await supabaseAdmin
      .from('user_store_data')
      .update({ cart, updated_at: new Date() })
      .eq('id', session.userId);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==============================================================
// MARK MIXTAPE PURCHASED ENDPOINT
// ==============================================================
app.post('/api/mark-mixtape', async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken || !global.sessions.has(sessionToken)) {
    return res.json({ success: false, error: 'Invalid session' });
  }

  const session = global.sessions.get(sessionToken);
  try {
    await supabaseAdmin
      .from('user_store_data')
      .update({ has_purchased_mixtape: true, updated_at: new Date() })
      .eq('id', session.userId);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==============================================================
// LOGOUT ENDPOINT
// ==============================================================
app.post('/api/logout', (req, res) => {
  const { sessionToken } = req.body;
  if (sessionToken && global.sessions) {
    global.sessions.delete(sessionToken);
  }
  res.json({ success: true });
});

// ==============================================================
// FORGOT PASSWORD ENDPOINT (using Brevo)
// ==============================================================
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, error: 'Email required' });

  const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) return res.json({ success: false, error: listError.message });

  const user = users.find(u => u.email === email);
  if (!user) return res.json({ success: false, error: 'Email not found' });

  if (!BREVO_API_KEY) return res.json({ success: false, error: 'Email service not configured' });

  const resetToken = crypto.randomBytes(32).toString('hex');
  global.resetTokens[email] = { token: resetToken, expires: Date.now() + 3600000 };
  const resetLink = `https://mryoungfargo.github.io/MrYoungFargo/reset-password.html?token=${resetToken}&email=${encodeURIComponent(email)}`;

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'MrYoungFargo', email: 'noreply@mryoungfargo.com' },
        to: [{ email }],
        subject: 'Reset your MrYoungFargo password',
        htmlContent: `<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #1a1a2e; color: #e0e0e0; border-radius: 10px;">
          <h2 style="color: #3b82f6;">Reset Your Password</h2>
          <p>Click the button below to create a new password. This link expires in 1 hour.</p>
          <a href="${resetLink}" style="display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Reset Password</a>
          <p style="font-size: 12px; color: #888;">If you didn't request this, please ignore this email.</p>
        </div>`
      })
    });
    if (response.ok) res.json({ success: true, message: 'Reset email sent' });
    else res.json({ success: false, error: 'Failed to send email' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==============================================================
// RESET PASSWORD ENDPOINT
// ==============================================================
app.post('/reset-password', (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!global.resetTokens[email] || global.resetTokens[email].token !== token || global.resetTokens[email].expires < Date.now()) {
    return res.json({ success: false, error: 'Invalid or expired reset token' });
  }
  delete global.resetTokens[email];
  res.json({ success: true, message: 'Password can now be reset' });
});

// ==============================================================
// IKHOKHA PAYMENT ENDPOINTS
// ==============================================================
const IKHOKHA_API_ENDPOINT = 'https://api.ikhokha.com/public-api/v1/api/payment';

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

app.post('/create-payment', async (req, res) => {
  const { amount, orderId } = req.body;
  if (!amount || amount <= 0) return res.json({ success: false, error: 'Invalid amount' });
  if (!IKHOKHA_APP_ID || !IKHOKHA_SECRET) return res.json({ success: false, error: 'API keys not configured' });

  const amountInCents = Math.round(amount * 100);
  const requestPayload = {
    entityID: IKHOKHA_APP_ID,
    amount: amountInCents,
    currency: 'ZAR',
    requesterUrl: 'https://mryoungfargo.github.io/MrYoungFargo/',
    mode: 'TEST',
    externalTransactionID: orderId || 'ORDER_' + Date.now(),
    urls: {
      callbackUrl: 'https://mryoungfargo-payment.onrender.com/webhook',
      successPageUrl: 'https://mryoungfargo.github.io/MrYoungFargo/success.html',
      failurePageUrl: 'https://mryoungfargo.github.io/MrYoungFargo/failed.html',
      cancelUrl: 'https://mryoungfargo.github.io/MrYoungFargo/cancel.html'
    }
  };

  const requestBodyStr = JSON.stringify(requestPayload);
  const payloadToSign = createPayloadToSign(IKHOKHA_API_ENDPOINT, requestBodyStr);
  const signature = generateSignature(payloadToSign, IKHOKHA_SECRET);

  try {
    const response = await fetch(IKHOKHA_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'IK-APPID': IKHOKHA_APP_ID, 'IK-SIGN': signature },
      body: requestBodyStr
    });
    const data = await response.json();
    if (data.paylinkUrl) res.json({ success: true, paymentUrl: data.paylinkUrl });
    else res.json({ success: false, error: data.message || 'Payment creation failed' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/webhook', (req, res) => {
  console.log('💰 Webhook received:', req.body);
  res.status(200).send('OK');
});

// ==============================================================
// TEST SUPABASE CONNECTION ENDPOINT
// ==============================================================
app.get('/test-supabase', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw error;
    res.json({ success: true, users: data.users.length });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==============================================================
// ROOT ENDPOINT
// ==============================================================
app.get('/', (req, res) => {
  res.json({ status: '✅ Payment API is running!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Supabase connected: ${SUPABASE_URL ? '✅' : '❌'}`);
});
