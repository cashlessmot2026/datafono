// Edge Function "datafono": crea cobros, verifica pagos con Mercado Pago,
// recibe webhooks y envía el comprobante por email (Resend).
//
// Secrets requeridos (Supabase > Edge Functions > Secrets):
//   MP_ACCESS_TOKEN   Access Token de producción de la app "Datafono Cashless"
//   RESEND_API_KEY    API key de https://resend.com (para enviar los emails)
//   RESEND_FROM       Remitente verificado, ej: "Datafono <cobros@tudominio.com>"
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const MP_API = 'https://api.mercadopago.com'
const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Datafono <onboarding@resend.dev>'
const FN_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/datafono`

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MP_STATUS: Record<string, string> = {
  approved: 'approved',
  authorized: 'in_process',
  in_process: 'in_process',
  in_mediation: 'in_process',
  pending: 'pending',
  rejected: 'rejected',
  cancelled: 'cancelled',
  refunded: 'refunded',
  charged_back: 'refunded',
}

async function mp(path: string, init: RequestInit = {}) {
  if (!MP_TOKEN) throw new Error('Falta configurar MP_ACCESS_TOKEN')
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? `Mercado Pago respondió ${res.status}`)
  return data
}

const money = (n: number, currency = 'COP') =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

async function sendReceipt(tx: Record<string, any>) {
  if (!RESEND_KEY || !tx.customer_email || tx.email_sent || tx.status !== 'approved') return false
  const { data: s } = await db.from('df_settings').select('*').eq('id', 1).single()
  const date = new Date(tx.updated_at ?? tx.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
  const rows = [
    ['Comercio', s?.business_name ?? ''],
    ...(s?.business_nit ? [['NIT', s.business_nit]] : []),
    ['Concepto', tx.description],
    ['Fecha', date],
    ['Medio', tx.method === 'tap' ? `Tarjeta sin contacto${tx.card_type ? ` (${tx.card_type === 'credit_card' ? 'crédito' : 'débito'})` : ''}` : 'Mercado Pago (QR / link)'],
    ...(tx.installments > 1 ? [['Cuotas', String(tx.installments)]] : []),
    ['Operación Mercado Pago', tx.mp_payment_id ?? '-'],
    ['Referencia', tx.id.slice(0, 8).toUpperCase()],
  ]
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:Arial,sans-serif">
  <div style="max-width:440px;margin:24px auto;background:#fff;border-radius:20px;overflow:hidden">
    <div style="background:#0b1020;color:#fff;padding:28px 24px;text-align:center">
      <div style="font-size:14px;opacity:.7">${s?.business_name ?? ''}</div>
      <div style="font-size:34px;font-weight:bold;margin:8px 0">${money(Number(tx.amount), s?.currency)}</div>
      <div style="display:inline-block;background:#22c55e;color:#04210f;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:bold">Pago aprobado</div>
    </div>
    <table style="width:100%;padding:16px 24px;font-size:14px;color:#333">
      ${rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#888">${k}</td><td style="padding:8px 0;text-align:right">${String(v).replace(/</g, '&lt;')}</td></tr>`).join('')}
    </table>
    <div style="padding:0 24px 24px;text-align:center;color:#888;font-size:12px">${s?.receipt_footer ?? ''}</div>
  </div></body></html>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [tx.customer_email],
      ...(s?.business_email ? { reply_to: s.business_email } : {}),
      subject: `Comprobante de pago ${money(Number(tx.amount), s?.currency)} - ${s?.business_name ?? ''}`,
      html,
    }),
  })
  if (!res.ok) {
    console.error('Resend error', await res.text())
    return false
  }
  await db.from('df_transactions').update({ email_sent: true }).eq('id', tx.id)
  return true
}

// Aplica un pago de Mercado Pago a una transacción y envía el email si quedó aprobado
async function applyPayment(tx: Record<string, any>, payment: Record<string, any>) {
  if (Math.abs(Number(payment.transaction_amount) - Number(tx.amount)) > 0.01) {
    throw new Error('El monto del pago no coincide con el cobro')
  }
  const { data: other } = await db
    .from('df_transactions').select('id').eq('mp_payment_id', String(payment.id)).neq('id', tx.id).maybeSingle()
  if (other) throw new Error('Ese pago ya fue asociado a otro cobro')

  const patch = {
    status: MP_STATUS[payment.status] ?? 'pending',
    mp_payment_id: String(payment.id),
    mp_status_detail: payment.status_detail ?? null,
    card_type: payment.payment_type_id ?? tx.card_type,
    installments: payment.installments ?? tx.installments,
    customer_email: tx.customer_email || payment.payer?.email || null,
    updated_at: new Date().toISOString(),
  }
  const { data: updated, error } = await db.from('df_transactions').update(patch).eq('id', tx.id).select().single()
  if (error) throw error
  const emailed = await sendReceipt(updated)
  return { ...updated, email_sent: updated.email_sent || emailed }
}

const publicTx = (t: Record<string, any>) => ({
  id: t.id, amount: t.amount, description: t.description, method: t.method, status: t.status,
  mp_payment_id: t.mp_payment_id, email_sent: t.email_sent, customer_email: t.customer_email,
  created_at: t.created_at, updated_at: t.updated_at,
})

async function getTx(id: string) {
  const { data, error } = await db.from('df_transactions').select('*').eq('id', id).single()
  if (error || !data) throw new Error('Cobro no encontrado')
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)

  try {
    // Webhook de Mercado Pago (notification_url de las preferencias)
    if (url.searchParams.get('webhook') === '1') {
      const body = await req.json().catch(() => ({}))
      const type = body.type ?? url.searchParams.get('type') ?? url.searchParams.get('topic')
      const id = body.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id')
      if (type === 'payment' && id) {
        const payment = await mp(`/v1/payments/${id}`)
        if (payment.external_reference) {
          const tx = await getTx(payment.external_reference).catch(() => null)
          if (tx) await applyPayment(tx, payment)
        }
      }
      return json({ ok: true })
    }

    const body = await req.json()
    switch (body.action) {
      case 'create': {
        const amount = Math.round(Number(body.amount))
        if (!Number.isFinite(amount) || amount < 1000 || amount > 50_000_000) {
          return json({ error: 'Monto inválido (mínimo $1.000)' }, 400)
        }
        const email = String(body.customer_email ?? '').trim().toLowerCase()
        if (email && !EMAIL_RE.test(email)) return json({ error: 'Email inválido' }, 400)
        const method = body.method === 'qr' ? 'qr' : 'tap'
        const description = String(body.description ?? '').trim().slice(0, 120) || 'Venta'

        const { data: tx, error } = await db
          .from('df_transactions')
          .insert({ amount, description, customer_email: email || null, method })
          .select().single()
        if (error) throw error

        if (method === 'qr') {
          const pref = await mp('/checkout/preferences', {
            method: 'POST',
            headers: { 'X-Idempotency-Key': tx.id },
            body: JSON.stringify({
              items: [{ id: tx.id, title: description, quantity: 1, unit_price: amount, currency_id: 'COP' }],
              ...(email ? { payer: { email } } : {}),
              external_reference: tx.id,
              notification_url: `${FN_URL}?webhook=1`,
              statement_descriptor: 'DATAFONO',
            }),
          })
          await db.from('df_transactions').update({ mp_preference_id: pref.id }).eq('id', tx.id)
          return json({ tx: publicTx(tx), init_point: pref.init_point })
        }
        return json({ tx: publicTx(tx) })
      }

      case 'verify': {
        const tx = await getTx(String(body.tx_id))
        if (tx.status === 'approved') return json({ tx: publicTx(tx) })
        if (body.result_status === 'FAILED' && !body.payment_id) {
          const { data } = await db.from('df_transactions')
            .update({ status: 'rejected', mp_status_detail: body.error_detail ?? body.error ?? null, updated_at: new Date().toISOString() })
            .eq('id', tx.id).select().single()
          return json({ tx: publicTx(data) })
        }
        let payment = null
        if (body.payment_id) {
          payment = await mp(`/v1/payments/${encodeURIComponent(String(body.payment_id))}`)
        } else {
          const search = await mp(`/v1/payments/search?external_reference=${tx.id}&sort=date_created&criteria=desc`)
          payment = search.results?.[0] ?? null
        }
        if (!payment) return json({ tx: publicTx(tx) })
        return json({ tx: publicTx(await applyPayment(tx, payment)) })
      }

      case 'cancel': {
        const { data } = await db.from('df_transactions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', String(body.tx_id)).eq('status', 'pending').select().maybeSingle()
        return json({ tx: data ? publicTx(data) : null })
      }

      case 'resend_email': {
        const tx = await getTx(String(body.tx_id))
        const email = String(body.customer_email ?? tx.customer_email ?? '').trim().toLowerCase()
        if (!EMAIL_RE.test(email)) return json({ error: 'Email inválido' }, 400)
        const { data } = await db.from('df_transactions')
          .update({ customer_email: email, email_sent: false }).eq('id', tx.id).select().single()
        const sent = await sendReceipt(data)
        return json({ sent })
      }

      case 'health':
        return json({ ok: true, mercadopago: Boolean(MP_TOKEN), email: Boolean(RESEND_KEY) })

      default:
        return json({ error: 'Acción no soportada' }, 400)
    }
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
