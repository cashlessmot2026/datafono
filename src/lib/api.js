import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

async function call(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('datafono', { body: { action, ...payload } })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error ?? msg } catch { /* respuesta sin JSON */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export const api = {
  create: (p) => call('create', p),
  verify: (p) => call('verify', p),
  cancel: (tx_id) => call('cancel', { tx_id }),
  resendEmail: (tx_id, customer_email) => call('resend_email', { tx_id, customer_email }),
  health: () => call('health'),
}

export const isNative = () => Capacitor.isNativePlatform()

// URL a la que vuelve la app de Mercado Pago al terminar el cobro
export function returnUrl(txId) {
  if (isNative()) return `datafono://resultado?tx=${txId}`
  return `${location.origin}${location.pathname}?tx=${txId}`
}

// Deep link de Mercado Pago Point: abre la app de Mercado Pago (Tap to Pay / Point Tap),
// que lee la tarjeta por NFC de forma certificada y devuelve payment_id y result_status.
export function tapToPayUrl({ amount, description, txId }) {
  const back = returnUrl(txId)
  const q = new URLSearchParams({
    amount: String(amount),
    description,
    success_url: back,
    fail_url: back,
  })
  return `https://secure.mlstatic.com/org-img/point/app/index.html?${q}`
}
