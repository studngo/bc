const fetch = require('node-fetch');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured on the server');
  }
  return key;
}

/**
 * Initializes a charge on Paystack via the M-Pesa mobile money channel.
 * amountKobo must be the smallest currency unit (KSh * 100), calculated
 * server-side — never trust an amount from the client.
 */
async function initializeMpesaCharge({ amountKobo, email, phone, reference, metadata }) {
  const response = await fetch(`${PAYSTACK_BASE_URL}/charge`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: amountKobo,
      email,
      currency: 'KES',
      reference,
      mobile_money: {
        phone,
        provider: 'mpesa'
      },
      metadata
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = (data && data.message) || 'Failed to initialize payment with Paystack';
    const err = new Error(message);
    err.paystackResponse = data;
    throw err;
  }
  return data;
}

/**
 * Verifies a transaction by reference directly against Paystack.
 * Used both as a fallback poll and to double-check webhook payloads.
 */
async function verifyTransaction(reference) {
  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${getSecretKey()}` }
    }
  );
  const data = await response.json();
  if (!response.ok) {
    const message = (data && data.message) || 'Failed to verify transaction with Paystack';
    const err = new Error(message);
    err.paystackResponse = data;
    throw err;
  }
  return data;
}

module.exports = { initializeMpesaCharge, verifyTransaction, getSecretKey };
