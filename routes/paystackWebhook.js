const express = require('express');
const crypto = require('crypto');
const supabase = require('../config/supabaseClient');
const { finalizeRegistrationPayment, markRegistrationFailed } = require('../services/registrationService');

const router = express.Router();

// NOTE: this route is mounted with express.raw() in server.js (see server.js)
// so that req.body is the exact raw bytes Paystack signed — required for
// correct HMAC verification. Do NOT apply express.json() before this route.

// POST /api/paystack/webhook
router.post('/', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!signature || !secret) {
      return res.status(401).send('Missing signature');
    }

    const rawBody = req.body; // Buffer, thanks to express.raw()
    const expectedHash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    if (expectedHash !== signature) {
      console.warn('Paystack webhook: invalid signature received');
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const eventId = event.data && (event.data.id ? String(event.data.id) : event.data.reference);

    if (!eventId) {
      return res.status(400).send('Missing event identifier');
    }

    // Idempotency guard: record the event id before processing. If the
    // insert hits the unique constraint on event_id, this exact webhook
    // was already handled.
    let alreadySeen = false;
    const { error: insertError } = await supabase
      .from('webhook_events')
      .insert({ event_id: `${event.event}:${eventId}`, event_type: event.event });

    if (insertError) {
      if (insertError.code === '23505') {
        alreadySeen = true;
      } else {
        throw new Error(insertError.message);
      }
    }

    // Always return 200 quickly once signature is verified, to stop Paystack
    // retries — but only do the finalize work once.
    res.status(200).send('OK');

    if (alreadySeen) return;

    const reference = event.data && event.data.reference;
    if (!reference) return;

    const { data: registration, error: regError } = await supabase
      .from('registrations')
      .select('id')
      .eq('paystack_reference', reference)
      .maybeSingle();

    if (regError) {
      console.error('Paystack webhook: error looking up registration', regError.message);
      return;
    }
    if (!registration) {
      console.warn(`Paystack webhook: no registration found for reference ${reference}`);
      return;
    }

    if (event.event === 'charge.success') {
      await finalizeRegistrationPayment(registration.id);
    } else if (event.event === 'charge.failed') {
      await markRegistrationFailed(registration.id);
    }
  } catch (err) {
    console.error('Paystack webhook processing error:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Webhook processing error');
    }
  }
});

module.exports = router;
