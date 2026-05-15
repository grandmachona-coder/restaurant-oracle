/**
 * Bistro Steward — Transactional Email
 *
 * Provider: Resend (REST API, fetch-based — no SDK dep needed).
 * All senders are transactional; respect CAN-SPAM; never marketing here.
 *
 * Public surface:
 *   sendEmail(to, templateName, data) → { ok, id?, error? }
 *   TEMPLATES                         → set of template names
 *
 * Every send logs to /tenants/{tenantId}/audit_log if data.tenantId is passed,
 * otherwise to /audit_log (root). Logs include template name + recipient.
 */

'use strict';

const admin = require('firebase-admin');

const FROM_FALLBACK = 'onboarding@resend.dev';
const FROM_BRANDED  = 'Bistro Steward <noreply@bistrosteward.com>';
const REPLY_TO      = 'support@bistrosteward.com';
const APP_BASE_URL  = 'https://bistrosteward.com';
const SUPPORT_EMAIL = 'support@bistrosteward.com';
const BRAND_CITY    = 'Portland, OR';

// ── Template registry ──────────────────────────────────────────────────────
// Each template in BUILTIN_TEMPLATES (defined below) exports
// { subject(data), html(data), text(data) }. BUILTIN_TEMPLATES is the single
// source of truth — look up by name at send-time, not eagerly at module load
// (eager init caused a TDZ on the BUILTIN_TEMPLATES const).

// ── Public: send ───────────────────────────────────────────────────────────
async function sendEmail(to, templateName, data) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('[email] RESEND_API_KEY not configured — email not sent:', templateName, to);
    await logEmailSend(data && data.tenantId, to, templateName, false, 'RESEND_API_KEY missing');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }
  const tpl = BUILTIN_TEMPLATES[templateName];
  if (!tpl) {
    const err = 'Unknown template: ' + templateName;
    console.error('[email] ' + err);
    await logEmailSend(data && data.tenantId, to, templateName, false, err);
    return { ok: false, error: err };
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    const err = 'Invalid recipient: ' + to;
    console.error('[email] ' + err);
    await logEmailSend(data && data.tenantId, to, templateName, false, err);
    return { ok: false, error: err };
  }

  const payload = {
    from: process.env.RESEND_FROM || FROM_BRANDED,
    to: [to],
    reply_to: REPLY_TO,
    subject: tpl.subject(data || {}),
    html: tpl.html(data || {}),
    text: tpl.text(data || {}),
    headers: {
      'X-Entity-Ref-ID': (data && data.tenantId) || 'none',
      'List-Unsubscribe': '<mailto:' + SUPPORT_EMAIL + '?subject=Unsubscribe>',
    },
    tags: [
      { name: 'template', value: templateName },
      { name: 'tenant',   value: (data && data.tenantId) || 'none' },
    ],
  };

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = 'Resend ' + resp.status + ': ' + (body.message || body.error || 'unknown');
      console.error('[email] send failed', templateName, to, err);
      await logEmailSend(data && data.tenantId, to, templateName, false, err);
      return { ok: false, error: err };
    }
    console.log('[email] sent', templateName, to, body.id);
    await logEmailSend(data && data.tenantId, to, templateName, true, body.id);
    return { ok: true, id: body.id };
  } catch (e) {
    console.error('[email] send exception', templateName, to, e.message);
    await logEmailSend(data && data.tenantId, to, templateName, false, e.message);
    return { ok: false, error: e.message };
  }
}

async function logEmailSend(tenantId, to, template, success, info) {
  try {
    const db = admin.firestore();
    const entry = {
      user_id: 'email_system',
      user_email: to || 'unknown',
      tenant_id: tenantId || 'unknown',
      operation: 'email_sent:' + template,
      collection: 'emails',
      record_count: success ? 1 : 0,
      email_info: info || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = tenantId
      ? db.collection('tenants').doc(tenantId).collection('audit_log')
      : db.collection('audit_log');
    await ref.add(entry);
  } catch (e) {
    console.warn('[email] audit log failed:', e.message);
  }
}

// ── Style shared across templates ──────────────────────────────────────────
// Inlined per template (HTML email clients drop <style> blocks often).
function layout({ preheader, heading, bodyHtml, ctaLabel, ctaUrl, noteHtml }) {
  const cta = ctaUrl && ctaLabel
    ? `<tr><td align="center" style="padding:24px 0 12px 0;">
         <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;background:#f6b43b;color:#0f1117;text-decoration:none;font-weight:600;border-radius:8px;font-family:Inter,Arial,sans-serif;font-size:15px;">${escapeHtml(ctaLabel)}</a>
       </td></tr>`
    : '';
  const note = noteHtml
    ? `<tr><td style="padding:12px 0 0 0;color:#64748b;font-size:13px;line-height:1.55;font-family:Inter,Arial,sans-serif;">${noteHtml}</td></tr>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:Inter,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || '')}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0f1117;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#1e293b 0%,#0f1117 100%);padding:28px 32px;border-radius:12px 12px 0 0;border:1px solid #1f2937;border-bottom:none;">
        <div style="color:#f6b43b;font-size:14px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;font-family:Inter,Arial,sans-serif;">Bistro Steward</div>
        <div style="color:#e2e8f0;font-size:22px;font-weight:600;margin-top:6px;font-family:Inter,Arial,sans-serif;line-height:1.3;">${escapeHtml(heading)}</div>
      </td></tr>
      <tr><td style="background:#ffffff;padding:28px 32px 20px 32px;border:1px solid #1f2937;border-top:none;border-radius:0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr><td style="color:#0f1117;font-size:15px;line-height:1.6;font-family:Inter,Arial,sans-serif;">${bodyHtml}</td></tr>
          ${cta}
          ${note}
        </table>
      </td></tr>
      <tr><td style="background:#0b0d14;color:#64748b;font-size:12px;line-height:1.55;padding:18px 32px;border:1px solid #1f2937;border-top:none;border-radius:0 0 12px 12px;font-family:Inter,Arial,sans-serif;">
        Bistro Steward · ${BRAND_CITY} · <a href="mailto:${SUPPORT_EMAIL}" style="color:#94a3b8;text-decoration:underline;">${SUPPORT_EMAIL}</a><br>
        This is a transactional message about your account.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(cents) {
  const n = Number(cents || 0) / 100;
  return '$' + n.toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Built-in templates ─────────────────────────────────────────────────────
// data fields referenced: ownerName, restaurantName, plan, priceCents, last4,
// nextBillingDate, trialEndsAt, inviterName, inviteeRole, signupUrl, tenantId.

const BUILTIN_TEMPLATES = {

  owner_welcome: {
    subject: () => 'Welcome to Bistro Steward',
    html: (d) => layout({
      preheader: 'Your restaurant is provisioned. Here are the first 3 steps.',
      heading: `Welcome, ${escapeHtml(d.restaurantName || 'there')}.`,
      bodyHtml: `
        <p>Your Bistro Steward account is live. Your 30-day free trial has started — no charge until <strong>${escapeHtml(fmtDate(d.trialEndsAt) || 'day 30')}</strong>.</p>
        <p style="margin-top:16px;"><strong>Three things to do first:</strong></p>
        <ol style="padding-left:20px;margin:8px 0 0 0;color:#0f1117;">
          <li style="margin:6px 0;">Add a few ingredients and set their current costs.</li>
          <li style="margin:6px 0;">Create your first recipe so the engine can compute food cost.</li>
          <li style="margin:6px 0;">Run a count in <em>Inventory Scan</em> — snap a photo of your walk-in.</li>
        </ol>
        <p style="margin-top:16px;">Questions? Reply to this email — it goes straight to ${escapeHtml(SUPPORT_EMAIL)}.</p>`,
      ctaLabel: 'Open Bistro Steward',
      ctaUrl: APP_BASE_URL + '/app/',
    }),
    text: (d) => [
      `Welcome to Bistro Steward, ${d.restaurantName || 'there'}.`,
      ``,
      `Your 30-day free trial is active. No charge until ${fmtDate(d.trialEndsAt) || 'day 30'}.`,
      ``,
      `First 3 steps:`,
      `  1. Add ingredients + costs`,
      `  2. Create your first recipe`,
      `  3. Run an inventory scan`,
      ``,
      `Open the app: ${APP_BASE_URL}/app/`,
      `Questions? ${SUPPORT_EMAIL}`,
    ].join('\n'),
  },

  trial_ending_7d: {
    subject: () => 'Your trial ends in 7 days',
    html: (d) => layout({
      preheader: 'Your Bistro Steward trial converts to a paid plan in 7 days.',
      heading: '7 days left in your free trial',
      bodyHtml: `
        <p>Your Bistro Steward trial ends on <strong>${escapeHtml(fmtDate(d.trialEndsAt) || 'day 30')}</strong>.</p>
        <p>On that date, the card on file ending in <strong>${escapeHtml(d.last4 || '••••')}</strong> will be charged <strong>${escapeHtml(money(d.priceCents))}</strong> for the <strong>${escapeHtml(d.plan || 'current')}</strong> plan.</p>
        <p>No action needed if you want to keep going — billing is automatic. If you need to change plans, update your card, or cancel, use the Billing menu.</p>`,
      ctaLabel: 'Manage Billing',
      ctaUrl: APP_BASE_URL + '/app/#menu-billing',
    }),
    text: (d) => [
      `Your Bistro Steward trial ends in 7 days (${fmtDate(d.trialEndsAt) || 'day 30'}).`,
      ``,
      `Card ending ${d.last4 || '••••'} will be charged ${money(d.priceCents)} for the ${d.plan || 'current'} plan.`,
      ``,
      `Manage billing: ${APP_BASE_URL}/app/#menu-billing`,
      `Questions? ${SUPPORT_EMAIL}`,
    ].join('\n'),
  },

  trial_ending_2d: {
    subject: () => 'Your trial ends in 2 days',
    html: (d) => layout({
      preheader: 'Your Bistro Steward trial ends in 2 days.',
      heading: '2 days left in your free trial',
      bodyHtml: `
        <p>Your trial ends on <strong>${escapeHtml(fmtDate(d.trialEndsAt) || 'day 30')}</strong> — just 2 days away.</p>
        <p>Card on file ending <strong>${escapeHtml(d.last4 || '••••')}</strong> will be charged <strong>${escapeHtml(money(d.priceCents))}</strong> for the <strong>${escapeHtml(d.plan || 'current')}</strong> plan.</p>
        <p>If you want to change plans or cancel before billing starts, do it now from the Billing menu.</p>`,
      ctaLabel: 'Manage Billing',
      ctaUrl: APP_BASE_URL + '/app/#menu-billing',
    }),
    text: (d) => [
      `Your trial ends in 2 days (${fmtDate(d.trialEndsAt) || 'day 30'}).`,
      ``,
      `Card ending ${d.last4 || '••••'} will be charged ${money(d.priceCents)} for the ${d.plan || 'current'} plan.`,
      ``,
      `Manage billing: ${APP_BASE_URL}/app/#menu-billing`,
    ].join('\n'),
  },

  trial_ending_today: {
    subject: () => 'Your free trial ends today',
    html: (d) => layout({
      preheader: 'Your Bistro Steward trial ends today.',
      heading: 'Your free trial ends today',
      bodyHtml: `
        <p>Today is day 30 — your free trial wraps up and billing kicks in.</p>
        <p>Card ending <strong>${escapeHtml(d.last4 || '••••')}</strong> will be charged <strong>${escapeHtml(money(d.priceCents))}</strong> for the <strong>${escapeHtml(d.plan || 'current')}</strong> plan. A receipt will follow.</p>
        <p>No action needed to continue. Questions? Reply to this email.</p>`,
      ctaLabel: 'Manage Billing',
      ctaUrl: APP_BASE_URL + '/app/#menu-billing',
    }),
    text: (d) => [
      `Your free trial ends today.`,
      ``,
      `Card ending ${d.last4 || '••••'} will be charged ${money(d.priceCents)} for the ${d.plan || 'current'} plan.`,
      ``,
      `Manage billing: ${APP_BASE_URL}/app/#menu-billing`,
    ].join('\n'),
  },

  first_charge_receipt: {
    subject: (d) => `Receipt from Bistro Steward — ${money(d.amountCents || d.priceCents)}`,
    html: (d) => layout({
      preheader: `Payment of ${money(d.amountCents || d.priceCents)} received.`,
      heading: `Receipt — ${money(d.amountCents || d.priceCents)}`,
      bodyHtml: `
        <p>Thanks for subscribing to Bistro Steward. Here is your receipt.</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 14px;background:#f8fafc;font-size:13px;color:#475569;">Restaurant</td>
              <td style="padding:10px 14px;background:#f8fafc;font-size:13px;color:#0f1117;text-align:right;">${escapeHtml(d.restaurantName || '')}</td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#475569;">Plan</td>
              <td style="padding:10px 14px;font-size:13px;color:#0f1117;text-align:right;">${escapeHtml(d.plan || '')}</td></tr>
          <tr><td style="padding:10px 14px;background:#f8fafc;font-size:13px;color:#475569;">Amount</td>
              <td style="padding:10px 14px;background:#f8fafc;font-size:13px;color:#0f1117;text-align:right;"><strong>${escapeHtml(money(d.amountCents || d.priceCents))}</strong></td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#475569;">Card</td>
              <td style="padding:10px 14px;font-size:13px;color:#0f1117;text-align:right;">•••• ${escapeHtml(d.last4 || '••••')}</td></tr>
          <tr><td style="padding:10px 14px;background:#f8fafc;font-size:13px;color:#475569;">Paid on</td>
              <td style="padding:10px 14px;background:#f8fafc;font-size:13px;color:#0f1117;text-align:right;">${escapeHtml(fmtDate(d.paidAt) || fmtDate(new Date()))}</td></tr>
          <tr><td style="padding:10px 14px;font-size:13px;color:#475569;">Next billing date</td>
              <td style="padding:10px 14px;font-size:13px;color:#0f1117;text-align:right;">${escapeHtml(fmtDate(d.nextBillingDate) || '—')}</td></tr>
        </table>
        <p style="margin-top:16px;">Invoice ID: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px;">${escapeHtml(d.invoiceId || '—')}</code></p>`,
      ctaLabel: 'View Billing',
      ctaUrl: APP_BASE_URL + '/app/#menu-billing',
    }),
    text: (d) => [
      `Receipt from Bistro Steward`,
      ``,
      `Restaurant: ${d.restaurantName || ''}`,
      `Plan: ${d.plan || ''}`,
      `Amount: ${money(d.amountCents || d.priceCents)}`,
      `Card: •••• ${d.last4 || '••••'}`,
      `Paid on: ${fmtDate(d.paidAt) || fmtDate(new Date())}`,
      `Next billing date: ${fmtDate(d.nextBillingDate) || '—'}`,
      `Invoice ID: ${d.invoiceId || '—'}`,
      ``,
      `Billing: ${APP_BASE_URL}/app/#menu-billing`,
    ].join('\n'),
  },

  payment_failed: {
    subject: () => 'Payment failed — action needed',
    html: (d) => layout({
      preheader: 'Your payment did not go through. Update your card to keep access.',
      heading: 'Your payment failed',
      bodyHtml: `
        <p>We tried to charge <strong>${escapeHtml(money(d.amountCents || d.priceCents))}</strong> to the card ending <strong>${escapeHtml(d.last4 || '••••')}</strong> and it was declined.</p>
        <p><strong>What happens next:</strong> Square will retry automatically. If the card still fails after 7 days, your account will be suspended and team logins will stop working.</p>
        <p>Update your card now to avoid any interruption.</p>`,
      ctaLabel: 'Update Card',
      ctaUrl: APP_BASE_URL + '/app/#menu-billing',
      noteHtml: `If you believe this is an error, reply to this email — a human will help.`,
    }),
    text: (d) => [
      `Payment failed.`,
      ``,
      `We tried to charge ${money(d.amountCents || d.priceCents)} to card ending ${d.last4 || '••••'} and it was declined.`,
      ``,
      `Square will retry automatically. After 7 days of failures, access is suspended.`,
      ``,
      `Update card: ${APP_BASE_URL}/app/#menu-billing`,
      `Questions? ${SUPPORT_EMAIL}`,
    ].join('\n'),
  },

  subscription_cancelled: {
    subject: () => 'Subscription cancelled',
    html: (d) => layout({
      preheader: `Your Bistro Steward subscription is cancelled. Access remains through ${fmtDate(d.endsAt) || 'end of billing period'}.`,
      heading: 'Your subscription is cancelled',
      bodyHtml: `
        <p>We have cancelled your Bistro Steward subscription. You will keep full access through <strong>${escapeHtml(fmtDate(d.endsAt) || 'the end of your current billing period')}</strong>, after which the account switches to read-only.</p>
        <p>Your data stays in place for <strong>90 days</strong> in case you change your mind. Reactivate anytime with a click — no re-onboarding.</p>`,
      ctaLabel: 'Reactivate',
      ctaUrl: APP_BASE_URL + '/app/#menu-billing',
    }),
    text: (d) => [
      `Your Bistro Steward subscription is cancelled.`,
      ``,
      `Access remains through ${fmtDate(d.endsAt) || 'end of billing period'}.`,
      `Your data is retained for 90 days.`,
      ``,
      `Reactivate: ${APP_BASE_URL}/app/#menu-billing`,
    ].join('\n'),
  },

  subscription_reactivated: {
    subject: () => 'Welcome back',
    html: (d) => layout({
      preheader: 'Your subscription is active again.',
      heading: 'Welcome back',
      bodyHtml: `
        <p>Your Bistro Steward subscription has been reactivated. Your <strong>${escapeHtml(d.plan || 'current')}</strong> plan is active, card ending <strong>${escapeHtml(d.last4 || '••••')}</strong> will be billed on <strong>${escapeHtml(fmtDate(d.nextBillingDate) || 'next cycle')}</strong>.</p>
        <p>All your data, recipes, and settings are right where you left them.</p>`,
      ctaLabel: 'Open Bistro Steward',
      ctaUrl: APP_BASE_URL + '/app/',
    }),
    text: (d) => [
      `Welcome back to Bistro Steward.`,
      ``,
      `${d.plan || 'Your plan'} is active. Next charge: ${fmtDate(d.nextBillingDate) || 'next cycle'} on card •••• ${d.last4 || '••••'}.`,
      ``,
      `Open the app: ${APP_BASE_URL}/app/`,
    ].join('\n'),
  },

  team_invite: {
    subject: (d) => `${d.inviterName || 'Your team'} invited you to ${d.restaurantName || 'Bistro Steward'}`,
    html: (d) => layout({
      preheader: `${d.inviterName || 'Your team'} added you to ${d.restaurantName || 'their'} Bistro Steward account.`,
      heading: `You were added to ${escapeHtml(d.restaurantName || 'Bistro Steward')}`,
      bodyHtml: `
        <p><strong>${escapeHtml(d.inviterName || 'Your team')}</strong> added you to the <strong>${escapeHtml(d.restaurantName || '')}</strong> account on Bistro Steward as a <strong>${escapeHtml(d.inviteeRole || 'team member')}</strong>.</p>
        <p>Click below to set a password and sign in. The link is valid for one hour.</p>`,
      ctaLabel: 'Set Password & Sign In',
      ctaUrl: d.setupLink || (APP_BASE_URL + '/app/'),
      noteHtml: `If you were not expecting this, just ignore the email. Questions: <a href="mailto:${SUPPORT_EMAIL}" style="color:#475569;">${SUPPORT_EMAIL}</a>.`,
    }),
    text: (d) => [
      `${d.inviterName || 'Your team'} invited you to ${d.restaurantName || 'Bistro Steward'}.`,
      ``,
      `Role: ${d.inviteeRole || 'team member'}`,
      ``,
      `Set your password and sign in:`,
      `  ${d.setupLink || APP_BASE_URL + '/app/'}`,
      ``,
      `Questions? ${SUPPORT_EMAIL}`,
    ].join('\n'),
  },

};

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  sendEmail,
  TEMPLATES: Object.keys(BUILTIN_TEMPLATES),
  APP_BASE_URL,
  SUPPORT_EMAIL,
};
