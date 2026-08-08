const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabaseClient');
const { throwIfSupabaseError } = require('../utils/supabaseErrors');
const { ApiError } = require('../middleware/errorHandler');
const { normalizeKenyanPhone } = require('../utils/phone');
const { initializeMpesaCharge, verifyTransaction } = require('../services/paystackService');
const {
  recalculateRegistrationAmount,
  finalizeRegistrationPayment,
  markRegistrationFailed
} = require('../services/registrationService');

const router = express.Router();

const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment attempts. Please wait a few minutes and try again.' }
});

// POST /api/payments/initialize
// Body: { registrationId, mpesaPhone, email? }
router.post('/initialize', paymentLimiter, async (req, res, next) => {
  try {
    const { registrationId, mpesaPhone, email } = req.body;

    if (!registrationId) throw new ApiError(400, 'Registration reference is missing.');

    const normalizedPhone = normalizeKenyanPhone(mpesaPhone);
    if (!normalizedPhone) {
      throw new ApiError(400, 'Please enter a valid M-Pesa number, e.g. 07XXXXXXXX.');
    }

    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('*')
      .eq('id', registrationId)
      .maybeSingle();
    throwIfSupabaseError(regError);
    if (!registration) throw new ApiError(404, 'Registration not found.');
    if (registration.payment_status === 'paid') {
      throw new ApiError(400, 'This registration has already been paid for.');
    }

    // Server-side recalculation — the amount is NEVER taken from the client.
    const { count, amount } = await recalculateRegistrationAmount(registrationId);
    if (count === 0) {
      throw new ApiError(400, 'Please add at least one student before proceeding to payment.');
    }

    const amountKobo = amount * 100; // Paystack expects the smallest currency unit

    const paystackReference = `${registration.registration_reference}-${Date.now()}`;

    const chargeResponse = await initializeMpesaCharge({
      amountKobo,
      email: email && String(email).includes('@') ? email : 'no-reply@studentsngohelp.org',
      phone: normalizedPhone,
      reference: paystackReference,
      metadata: { registrationId, registrationReference: registration.registration_reference }
    });

    const { error: updateError } = await supabase
      .from('registrations')
      .update({ mpesa_phone: normalizedPhone, paystack_reference: paystackReference })
      .eq('id', registrationId);
    throwIfSupabaseError(updateError);

    res.json({
      message: 'Payment prompt sent. Please check your phone and enter your M-Pesa PIN.',
      reference: paystackReference,
      amount,
      numberOfStudents: count,
      paystackStatus: chargeResponse.data ? chargeResponse.data.status : undefined
    });
  } catch (err) {
    if (err.paystackResponse) {
      return next(new ApiError(502, 'We could not reach the payment provider. Please try again.'));
    }
    next(err);
  }
});

// GET /api/payments/verify/:reference — manual/poll fallback verification
router.get('/verify/:reference', async (req, res, next) => {
  try {
    const { reference } = req.params;

    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('*')
      .eq('paystack_reference', reference)
      .maybeSingle();
    throwIfSupabaseError(regError);
    if (!registration) throw new ApiError(404, 'Payment reference not found.');

    if (registration.payment_status === 'paid') {
      return res.json({ status: 'paid', registration });
    }

    const verification = await verifyTransaction(reference);
    const status = verification.data && verification.data.status; // 'success' | 'failed' | 'abandoned' | ...

    if (status === 'success') {
      await finalizeRegistrationPayment(registration.id);
    } else if (status === 'failed' || status === 'abandoned') {
      await markRegistrationFailed(registration.id);
    }

    const { data: updated, error: refetchError } = await supabase
      .from('registrations')
      .select('*')
      .eq('id', registration.id)
      .single();
    throwIfSupabaseError(refetchError);

    res.json({ status: updated.payment_status, registration: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
