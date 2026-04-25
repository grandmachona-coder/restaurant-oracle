// ════════════════════════════════════════════════════════════════════════════
//  INBOUND INVOICE PROCESSING
//  SendGrid Inbound Parse → Gemini Vision → ingredient cost update
// ════════════════════════════════════════════════════════════════════════════
//
// Setup:
//   1. SendGrid account, Inbound Parse enabled.
//   2. MX record for invoices.restaurantoracle.app → mx.sendgrid.net (priority 10).
//   3. In SendGrid: add hostname `invoices.restaurantoracle.app`, URL
//      `https://us-central1-<project>.cloudfunctions.net/inboundInvoice`,
//      POST raw (multipart), check "Send Raw" = false, check "Spam Check".
//   4. Set secret: `firebase functions:config:set invoice.sharedsecret="<random>"`
//      (optional — recommended — pass via x-webhook-secret header in SendGrid's
//      parse URL query string, validated below).
//
// Per-tenant routing:
//   Each tenant has `tenants/{id}.invoiceToken` (8-char hex).
//   Email arrives at `<token>@invoices.restaurantoracle.app`.
//   We parse the `to` field → extract token → look up tenant.

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const Busboy = require('@fastify/busboy');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Defer admin.firestore() until first use — index.js calls initializeApp()
// before any handler runs, but module-load-time access fails because
// require() can fire before initializeApp(). Use the getter everywhere.
function db() { return admin.firestore(); }

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB per file
const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // 15MB per email
const ALLOWED_MIME = /^(image\/(jpeg|png|webp|heic|gif)|application\/pdf)$/i;

function parseEmailMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    let totalBytes = 0;
    let rejected = false;

    const bb = Busboy.default ? new Busboy.default({
      headers: req.headers,
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 10, fields: 50 }
    }) : new Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 10, fields: 50 }
    });

    bb.on('field', (name, val) => {
      fields[name] = (typeof val === 'string' ? val : String(val || '')).slice(0, 100000);
    });

    bb.on('file', (name, stream, info) => {
      const { filename, mimeType, mimetype } = info || {};
      const mt = (mimeType || mimetype || '').toLowerCase();
      if (!ALLOWED_MIME.test(mt)) {
        stream.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        totalBytes += chunk.length;
        if (totalBytes > MAX_TOTAL_BYTES && !rejected) {
          rejected = true;
          reject(new Error('Total attachment size exceeds 15MB'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('limit', () => {
        rejected = true;
        reject(new Error('Attachment exceeds 5MB'));
      });
      stream.on('end', () => {
        if (rejected) return;
        files.push({
          filename: String(filename || 'attachment').slice(0, 200),
          mimeType: mt,
          buffer: Buffer.concat(chunks),
          size
        });
      });
    });

    bb.on('finish', () => { if (!rejected) resolve({ fields, files }); });
    bb.on('error', (err) => reject(err));

    // Firebase Functions v1 exposes rawBody
    if (req.rawBody) bb.end(req.rawBody);
    else req.pipe(bb);
  });
}

function extractToken(toField) {
  // "to" from SendGrid is like: `"Name" <abc12345@invoices.restaurantoracle.app>, other@x.com`
  // Grab first `<token>@invoices.restaurantoracle.app` match.
  const m = String(toField || '').match(/([a-f0-9]{6,32})@invoices\.restaurantoracle\.app/i);
  return m ? m[1].toLowerCase() : null;
}

async function findTenantByToken(token) {
  if (!token) return null;
  const snap = await db().collection('tenants').where('invoiceToken', '==', token).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

// Gemini structured-extraction prompt
const INVOICE_SCHEMA_PROMPT = `You are an invoice parser for a restaurant inventory system. Extract line items from the invoice image/PDF.

Return ONLY a JSON object matching this schema (no markdown):
{
  "vendor": { "name": "string", "phone": "string", "email": "string" },
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "currency": "USD",
  "lineItems": [
    { "description": "string (verbatim from invoice)", "qty": number, "unit": "ea|lb|oz|kg|g|gal|qt|pt|cup|fl oz|ml|L|case|box|bag|bunch|bottle", "unitPrice": number, "lineTotal": number, "sku": "string or empty" }
  ],
  "subtotal": number,
  "tax": number,
  "total": number,
  "notes": "string — anything unusual (backorder, credit memo, sub, etc.)"
}

RULES:
- If a field is unreadable, use empty string "" or 0.
- For unit, pick the closest match from the list above based on the invoice wording.
- unitPrice = lineTotal / qty (compute if one is missing but the other is visible).
- Do not include non-purchase lines (credits, fees, tax — those go in their own fields).
- Return JSON only. No commentary.`;

async function callGemini(apiKey, files) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  // Send first attachment only for Phase 1. Multi-page handled by Gemini natively.
  const att = files[0];
  const parts = [
    { text: INVOICE_SCHEMA_PROMPT },
    { inlineData: { data: att.buffer.toString('base64'), mimeType: att.mimeType } }
  ];
  const result = await model.generateContent({
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json' }
  });
  const txt = result.response.text().trim();
  try {
    return JSON.parse(txt);
  } catch (e) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Gemini returned non-JSON');
  }
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function matchIngredient(tenantId, description) {
  const q = normalize(description);
  if (!q) return null;
  const ingsSnap = await db().collection('tenants').doc(tenantId).collection('ings').get();
  let best = null, bestScore = 0;
  ingsSnap.forEach((doc) => {
    const d = doc.data();
    if (d.archived) return;
    const n = normalize(d.name);
    if (!n) return;
    // Simple scoring: exact > full-substring > word-overlap.
    if (n === q) { best = d; bestScore = 100; return; }
    if (q.includes(n) || n.includes(q)) {
      if (bestScore < 70) { best = d; bestScore = 70; }
      return;
    }
    const qWords = q.split(' ');
    const nWords = n.split(' ');
    const overlap = qWords.filter((w) => w.length > 2 && nWords.includes(w)).length;
    const score = (overlap / Math.max(qWords.length, nWords.length)) * 50;
    if (score > bestScore) { best = d; bestScore = score; }
  });
  return bestScore >= 30 ? best : null;
}

async function upsertVendor(tenantId, vendorInfo) {
  if (!vendorInfo || !vendorInfo.name) return null;
  const qname = normalize(vendorInfo.name);
  const vSnap = await db().collection('tenants').doc(tenantId).collection('vendors').get();
  for (const doc of vSnap.docs) {
    if (normalize(doc.data().name) === qname) return { id: Number(doc.id), ...doc.data() };
  }
  // Create new vendor
  const counterRef = db().collection('tenants').doc(tenantId).collection('counters').doc('next_id');
  const newId = await db().runTransaction(async (t) => {
    const d = await t.get(counterRef);
    const current = d.exists ? (d.data().value || 1000) : 1000;
    t.set(counterRef, { value: current + 1 }, { merge: true });
    return current + 1;
  });
  const rec = {
    id: newId,
    name: String(vendorInfo.name).slice(0, 200),
    contact_name: '',
    email: String(vendorInfo.email || '').slice(0, 200),
    phone: String(vendorInfo.phone || '').slice(0, 50),
    website: '',
    notes: 'Auto-created from inbound invoice',
    archived: 0
  };
  await db().collection('tenants').doc(tenantId).collection('vendors').doc(String(newId)).set(rec);
  return rec;
}

async function processInvoice(tenantId, parsed, files, emailMeta) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const counterRef = db().collection('tenants').doc(tenantId).collection('counters').doc('next_id');
  const invoiceId = await db().runTransaction(async (t) => {
    const d = await t.get(counterRef);
    const current = d.exists ? (d.data().value || 1000) : 1000;
    t.set(counterRef, { value: current + 1 }, { merge: true });
    return current + 1;
  });

  const vendor = await upsertVendor(tenantId, parsed.vendor || {});
  const vendorId = vendor ? vendor.id : 0;

  const lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
  const processed = [];
  const unmatched = [];

  for (const li of lineItems) {
    const desc = String(li.description || '').slice(0, 500);
    const qty = Number(li.qty) || 0;
    const unit = String(li.unit || 'ea').slice(0, 20);
    const unitPrice = Number(li.unitPrice) || (qty > 0 ? Number(li.lineTotal) / qty : 0);
    const ing = await matchIngredient(tenantId, desc);
    if (!ing) {
      unmatched.push({ description: desc, qty, unit, unitPrice, lineTotal: Number(li.lineTotal) || 0 });
      continue;
    }
    const ingRef = db().collection('tenants').doc(tenantId).collection('ings').doc(String(ing.id));
    const prevCost = Number(ing.cost) || 0;
    const history = Array.isArray(ing.price_history) ? ing.price_history.slice() : [];
    history.push({
      date: parsed.invoiceDate || new Date().toISOString().slice(0, 10),
      price: unitPrice,
      vendorId,
      invoiceId,
      unit
    });
    // Keep last 200 points max
    const trimmed = history.slice(-200);
    const vendorIds = Array.isArray(ing.vendor_ids) ? ing.vendor_ids.slice() : [];
    if (vendorId && !vendorIds.includes(vendorId)) vendorIds.push(vendorId);
    await ingRef.set({
      cost: unitPrice || prevCost,
      price_history: trimmed,
      vendor_id: ing.vendor_id || vendorId,
      vendor_ids: vendorIds
    }, { merge: true });
    processed.push({
      ingId: ing.id,
      name: ing.name,
      qty,
      unit,
      unitPrice,
      prevCost,
      delta: prevCost > 0 ? ((unitPrice - prevCost) / prevCost) * 100 : 0
    });
  }

  const invoiceDoc = {
    id: invoiceId,
    vendor_id: vendorId,
    vendor_name: (parsed.vendor && parsed.vendor.name) || '',
    invoice_number: String(parsed.invoiceNumber || '').slice(0, 100),
    invoice_date: String(parsed.invoiceDate || '').slice(0, 20),
    subtotal: Number(parsed.subtotal) || 0,
    tax: Number(parsed.tax) || 0,
    total: Number(parsed.total) || 0,
    line_items: lineItems.slice(0, 500),
    processed,
    unmatched,
    source_email: String((emailMeta && emailMeta.from) || '').slice(0, 300),
    subject: String((emailMeta && emailMeta.subject) || '').slice(0, 300),
    attachments: files.map((f) => ({ filename: f.filename, mimeType: f.mimeType, size: f.size })),
    raw_parsed: parsed,
    status: unmatched.length ? 'needs_review' : 'processed',
    created_at: now
  };
  await db().collection('tenants').doc(tenantId).collection('invoices')
    .doc(String(invoiceId)).set(invoiceDoc);

  return { invoiceId, processed: processed.length, unmatched: unmatched.length };
}

async function handleInbound(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  // Optional shared-secret check (set SendGrid parse URL with ?s=<secret>)
  try {
    const expectSecret = (functions.config().invoice && functions.config().invoice.sharedsecret) || null;
    if (expectSecret) {
      const given = req.query.s || req.headers['x-webhook-secret'] || '';
      if (given !== expectSecret) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }
  } catch (e) {
    // functions.config() can throw in emulator — ignore
  }

  let parsed;
  try {
    parsed = await parseEmailMultipart(req);
  } catch (e) {
    console.error('Multipart parse error:', e.message);
    res.status(400).json({ error: 'Malformed multipart' });
    return;
  }

  const toField = parsed.fields.to || parsed.fields.envelope
    ? (parsed.fields.to || (() => { try { return JSON.parse(parsed.fields.envelope).to?.[0] || ''; } catch (_) { return ''; } })())
    : '';
  const token = extractToken(toField);
  const tenant = await findTenantByToken(token);
  if (!tenant) {
    console.warn('No tenant for token:', token, 'to:', toField);
    res.status(202).json({ error: 'Unknown recipient — email discarded' });
    return;
  }

  if (!parsed.files.length) {
    res.status(202).json({ error: 'No attachments found' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not configured');
    res.status(500).json({ error: 'AI not configured' });
    return;
  }

  try {
    const ai = await callGemini(apiKey, parsed.files);
    const emailMeta = { from: parsed.fields.from, subject: parsed.fields.subject };
    const result = await processInvoice(tenant.id, ai, parsed.files, emailMeta);
    console.log('Invoice processed:', tenant.id, result);
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('Invoice processing error:', e.message, e.stack);
    // Persist a failure record for debugging
    try {
      await db().collection('tenants').doc(tenant.id).collection('invoices').add({
        status: 'failed',
        error: e.message.slice(0, 500),
        source_email: String(parsed.fields.from || ''),
        subject: String(parsed.fields.subject || ''),
        attachments: parsed.files.map((f) => ({ filename: f.filename, mimeType: f.mimeType, size: f.size })),
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (_) {}
    res.status(500).json({ error: 'Processing failed' });
  }
}

exports.inboundInvoice = functions
  .region('us-central1')
  .runWith({ maxInstances: 5, timeoutSeconds: 120, memory: '512MB' })
  .https.onRequest(handleInbound);

// Generate 8-hex-char token. Exported for provisionTenant to call.
exports.generateInvoiceToken = function () {
  const chars = 'abcdef0123456789';
  let t = '';
  for (let i = 0; i < 8; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
};
