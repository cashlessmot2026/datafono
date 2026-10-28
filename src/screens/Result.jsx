import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { money, STATUS_LABEL, vibrate } from '../lib/format'

export default function Result({ params, onNew }) {
  const [tx, setTx] = useState(null)
  const [error, setError] = useState(null)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sentMsg, setSentMsg] = useState(null)

  useEffect(() => {
    let alive = true
    api.verify(params)
      .then(({ tx }) => {
        if (!alive) return
        setTx(tx)
        setEmail(tx.customer_email ?? '')
        vibrate(tx.status === 'approved' ? [40, 60, 40] : 200)
      })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [params])

  const resend = async () => {
    setSending(true)
    setSentMsg(null)
    try {
      const { sent } = await api.resendEmail(tx.id, email)
      setSentMsg(sent ? 'Comprobante enviado' : 'No se pudo enviar el email')
    } catch (e) {
      setSentMsg(e.message)
    } finally {
      setSending(false)
    }
  }

  if (!tx && !error) {
    return (
      <main className="screen center">
        <div className="spinner" />
        <p className="muted">Confirmando el pago con Mercado Pago…</p>
      </main>
    )
  }

  const ok = tx?.status === 'approved'
  return (
    <main className={`screen center result ${ok ? 'ok' : 'fail'}`}>
      <div className="badge-icon">{ok ? '✓' : '!'}</div>
      <h1>{ok ? 'Pago aprobado' : tx ? STATUS_LABEL[tx.status] ?? 'Sin confirmar' : 'Error'}</h1>
      {tx && <div className="charge-amount">{money(tx.amount)}</div>}
      {tx && <div className="charge-desc">{tx.description}</div>}
      {params.error_detail && !ok && <div className="alert">Motivo: {params.error_detail}</div>}
      {error && <div className="alert">{error}</div>}
      {tx?.mp_payment_id && <div className="muted small">Operación MP #{tx.mp_payment_id}</div>}

      {ok && (
        <div className="receipt-box">
          {tx.email_sent && !sentMsg ? (
            <div className="hint ok">Comprobante enviado a {tx.customer_email}</div>
          ) : (
            <>
              <input className="field" type="email" placeholder="Email del cliente" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn secondary" disabled={!email || sending} onClick={resend}>
                {sending ? 'Enviando…' : 'Enviar comprobante'}
              </button>
            </>
          )}
          {sentMsg && <div className="hint">{sentMsg}</div>}
        </div>
      )}

      <button className="btn primary big" onClick={onNew}>Nuevo cobro</button>
    </main>
  )
}
