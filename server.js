require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const gradesRoutes = require('./routes/grades');
const registrationsRoutes = require('./routes/registrations');
const studentsRoutes = require('./routes/students');
const paymentsRoutes = require('./routes/payments');
const paystackWebhookRoutes = require('./routes/paystackWebhook');
const dashboardRoutes = require('./routes/dashboard');

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYSTACK_SECRET_KEY', 'JWT_SECRET', 'FRONTEND_URL'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.warn(`WARNING: missing environment variables: ${missing.join(', ')}. See .env.example.`);
}

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// CORS — only the configured frontend URL may call this API
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true
  })
);

// Global rate limit as a baseline safety net
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// The Paystack webhook MUST receive the raw request body for signature
// verification, so it is mounted BEFORE express.json() and given its own
// raw body parser limited to this route only.
app.use('/api/paystack/webhook', express.raw({ type: 'application/json' }), paystackWebhookRoutes);

// Standard JSON body parsing for every other route
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'students-ngo-help-api', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/grades', gradesRoutes);
app.use('/api/registrations', registrationsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Students NGO-Help API listening on port ${PORT}`);
});

module.exports = app;
