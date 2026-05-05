const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

// ==============================================================
// ENVIRONMENT VARIABLES
// ==============================================================
const IKHOKHA_APP_ID = process.env.IKHOKHA_APP_ID;
const IKHOKHA_SECRET = process.env.IKHOKHA_SECRET;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Your email for order notifications
const ADMIN_EMAIL = 'mryoungfargo@gmail.com';

// ==============================================================
// SUPABASE ADMIN CLIENT
// ==============================================================
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// In-memory session storage
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
// HELPER: Send order confirmation email
// ==============================================================
async function sendOrderConfirmationEmail(order) {
  if (!BREVO_API_KEY) {
    console.log('Brevo API key missing, skipping email');
    return;
  }
  
  // Build items table HTML
  const itemsHtml = order.items.map(item => `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.name}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.size || 'N/A'}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.color || 'N/A'}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${item.qty}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">R${item.price.toFixed(2)}</td>
    </tr>
  `).join('');
  
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #3b82f6;">🛍️ New Order!</h2>
      <p><strong>Order ID:</strong> ${order.order_id}</p>
      <p><strong>Customer:</strong> ${order.customer_email}</p>
      <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
      <p><strong>Total Amount:</strong> <span style="font-size: 1.2rem; color: #10b981;">R${order.total_amount.toFixed(2)}</span></p>
      
      <h3>Items Purchased:</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #1a1a2e;">
            <th style="padding: 8px; border: 1px solid #ddd;">Product</th>
            <th style="padding: 8px; border: 1px solid #ddd;">Size</th>
            <th style="padding: 8px; border: 1px solid #ddd;">Color</th>
            <th style="padding: 8px; border: 1px solid #ddd;">Qty</th>
            <th style="padding: 8px; border: 1px solid #ddd;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
      
      <hr style="margin: 20px 0;">
      <p style="color: #666; font-size: 12px;">This email was sent from your MrYoungFargo online store.</p>
    </div>
  `;
  
  try {
    // Send to admin
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'MrYoungFargo Store', email: 'noreply@mryoungfargo.com' },
        to: [{ email: ADMIN_EMAIL }],
        subject: `New Order #${order.order_id} - R${order.total_amount.toFixed(2)}`,
        htmlContent: emailHtml
      })
    });
    
    // Also send confirmation to customer
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'MrYoungFargo Store', email: 'noreply@mryoungfargo.com' },
        to: [{ email: order.customer_email }],
        subject: `Thank you for your order #${order.order_id}`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
            <h2 style="color: #3b82f6;">Thank You for Your Order!</h2>
            <p>Your order #${order.order_id} has been received and is being processed.</p>
            <p><strong>Total:</strong> R${order.total_amount.toFixed(2)}</p>
            <p>You will receive a download link for your mixtape (if purchased) within 24 hours.</p>
            <p>For any questions, reply to this email.</p>
          </div>
        `
      })
    });
    
    console.log(`Order confirmation emails sent for #${order.order_id}`);
  } catch (error) {
    console.error('Failed to send order email:', error);
  }
}

// ==============================================================
// HEALTH CHECK
// ==============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ==============================================================
// REGISTER
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
// LOGIN
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
// VERIFY SESSION
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
// UPDATE CART
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
// MARK MIXTAPE PURCHASED
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
// SAVE ORDER (called before payment)
// ==============================================================
app.post('/api/save-order', async (req, res) => {
  const { sessionToken, orderId, items, total, customerEmail } = req.body;
  
  if (!sessionToken || !global.sessions.has(sessionToken)) {
    return res.json({ success: false, error: 'Invalid session' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .insert([{
        order_id: orderId,
        customer_email: customerEmail,
        items: items,
        total_amount: total,
        payment_status: 'pending'
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, order: data });
  } catch (error) {
    console.error('Save order error:', error);
    res.json({ success: false, error: error.message });
  }
});

// ==============================================================
// UPDATE ORDER PAYMENT STATUS (called after payment success)
// ==============================================================
app.post('/api/update-order-status', async (req, res) => {
  const { orderId, paymentId } = req.body;
  
  try {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .update({ payment_status: 'paid', payment_id: paymentId, updated_at: new Date() })
      .eq('order_id', orderId)
      .select()
      .single();
    
    if (error) throw error;
    
    // Send order confirmation email
    await sendOrderConfirmationEmail(data);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update order status error:', error);
    res.json({ success: false, error: error.message });
  }
});

// ==============================================================
// GET ORDERS FOR A USER
// ==============================================================
app.post('/api/get-orders', async (req, res) => {
  const { sessionToken } = req.body;
  
  if (!sessionToken || !global.sessions.has(sessionToken)) {
    return res.json({ success: false, error: 'Invalid session' });
  }

  const session = global.sessions.get(sessionToken);
  
  try {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('customer_email', session.email)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({ success: true, orders: data });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ==============================================================
// LOGOUT
// ==============================================================
app.post('/api/logout', (req, res) => {
  const { sessionToken } = req.body;
  if (sessionToken && global.sessions) {
    global.sessions.delete(sessionToken);
  }
  res.json({ success: true });
});

// ==============================================================
// FORGOT PASSWORD
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
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: 'MrYoungFargo', email: 'noreply@mryoungfargo.com' },
        to: [{ email }],
        subject: 'Reset your MrYoungFargo password',
        htmlContent: `<div><h2>Reset Your Password</h2><a href="${resetLink}">Click here to reset your password</a><p>This link expires in 1 hour.</p></div>`
      })
    });
    res.json({ success: true, message: 'Reset email sent' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/reset-password', (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!global.resetTokens[email] || global.resetTokens[email].token !== token || global.resetTokens[email].expires < Date.now()) {
    return res.json({ success: false, error: 'Invalid or expired reset token' });
  }
  delete global.resetTokens[email];
  res.json({ success: true, message: 'Password can now be reset' });
});

// ==============================================================
// IKHOKHA PAYMENT
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
    if (data.paylinkUrl) res.json({ success: true, paymentUrl: data.paylinkUrl, paymentId: data.paylinkID });
    else res.json({ success: false, error: data.message || 'Payment creation failed' });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post('/webhook', async (req, res) => {
  console.log('💰 Webhook received:', req.body);
  const { paylinkID, status, externalTransactionID } = req.body;
  
  if (status === 'SUCCESS') {
    await supabaseAdmin
      .from('orders')
      .update({ payment_status: 'paid', payment_id: paylinkID, updated_at: new Date() })
      .eq('order_id', externalTransactionID);
  }
  
  res.status(200).send('OK');
});

// ==============================================================
// TEST ENDPOINTS
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

app.get('/', (req, res) => {
  res.json({ status: '✅ Payment API is running!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Supabase connected: ${SUPABASE_URL ? '✅' : '❌'}`);
});
