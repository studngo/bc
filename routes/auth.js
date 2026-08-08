const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabaseClient');
const { throwIfSupabaseError } = require('../utils/supabaseErrors');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// Slow down brute-force login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, 'Email and password are required.');
    }

    const { data: admin, error } = await supabase
      .from('admins')
      .select('id, email, password_hash, full_name, role')
      .eq('email', String(email).toLowerCase().trim())
      .maybeSingle();
    throwIfSupabaseError(error);

    // Constant-shape response whether or not the account exists
    const validPassword = admin
      ? await bcrypt.compare(password, admin.password_hash)
      : await bcrypt.compare(password, '$2a$10$invalidsaltinvalidsaltinvalidsaltinva');

    if (!admin || !validPassword) {
      throw new ApiError(401, 'Invalid email or password.');
    }

    const token = jwt.sign(
      { sub: admin.id, email: admin.email, role: admin.role, name: admin.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      admin: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — verify a stored token client-side without another login
const { requireAuth } = require('../middleware/auth');
router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

module.exports = router;
