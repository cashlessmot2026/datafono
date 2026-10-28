import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api, tapToPayUrl } from '../lib/api'
import { money } from '../lib/format'
import { NfcIcon } from './Terminal'

const POLL_MS = 3000

export default function Charge({ charge, onDone, onCancel }) {
  const [tx, setTx] = useState(null)
  const [qr, setQr] = useState(null)
  const [link, setLink] = useState(null)
  const [error, setError] = useState(null)
  const [manualId, setManualId] = useState('')
  const [checking, setChecking] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        const res = await api.create(charge)
        setTx(res.tx)
        if (charge.method === 'qr') {
          setLink(res.init_point)
          setQr(await QRCode.toDataURL(res.init_point, { margin: 1, width: 560, color: { dark: '#0b1020', light: '#ffffff' } }))
        } else {
          // Abre la app de Mercado Pago para leer la tarjeta por NFC
          location.href = tapToPayUrl({ amount: charge.amount, description: charge.description, txId: res.tx.id })
        }
      } catch (e) {
        setError(e.message)
      }
    })()
  }, [charge])

  // QR: consulta el estado hasta que el pago se resuelva
  useEffect(() => {
    if (!tx || charge.method !== 'qr') return
    const t = setInterval(async () => {
      try {
        const { tx: fresh } = await api.verify({ tx_id: tx.id })
        if (fresh.status !== 'pending') { clearInterval(t); onDone({ tx_id: tx.id }) }
      } catch { /* reintenta en el siguiente ciclo */ }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [tx, charge.method, onDone])

  const cancel = async () => {
    if (tx) await api.cancel(tx.id).catch(() => {})
    onCancel()
  }

  const verifyManual = async () => {
    if (!tx) return
    setChecking(true)
    setError(null)
    try {
      await api.verify({ tx_id: tx.id, payment_id: manualId.trim() || undefined })
      onDone({ tx_id: tx.id })
    } catch (e) {
      setError(e.message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <main className="screen charge">
      <div className="charge-amount">{money(charge.amount)}</div>
      <div className="charge-desc">{charge.description}</div>

      {error && <div className="alert">{error}</div>}

      {charge.method === 'tap' ? (
        <section className="tap-zone">
          <div className="nfc-pulse"><NfcIcon /></div>
          <h2>Acerque la tarjeta al celular</h2>
          <p className="muted">Se abrirá Mercado Pago para leer la tarjeta sin contacto. Al terminar volverás aquí automáticamente.</p>
          {tx && (
            <a className="btn primary" href={tapToPayUrl({ amount: charge.amount, description: charge.description, txId: tx.id })}>
              Abrir Mercado Pago
            </a>
          )}
          <details className="manual">
            <summary>¿No volvió automáticamente?</summary>
            <input
              className="field"
              inputMode="numeric"
              placeholder="N.º de operación de Mercado Pago"
              value={manualId}
              onChange={(e) => setManualId(e.target.value.replace(/\D/g, ''))}
            />
            <button className="btn secondary" disabled={!manualId || checking} onClick={verifyManual}>
              {checking ? 'Verificando…' : 'Verificar pago'}
            </button>
          </details>
        </section>
      ) : (
        <section className="qr-zone">
          {qr ? <img className="qr" src={qr} alt="Código QR de pago" /> : !error && <div className="spinner" />}
          <p className="muted">El cliente escanea el código con su celular y paga con Mercado Pago o tarjeta.</p>
          {link && (
            <button className="btn secondary" onClick={() => navigator.share?.({ title: 'Pago', url: link }) ?? navigator.clipboard?.writeText(link)}>
              Compartir link de pago
            </button>
          )}
          {!error && <div className="waiting"><span className="dot" /> Esperando el pago…</div>}
        </section>
      )}

      <button className="btn ghost" onClick={cancel}>Cancelar</button>
    </main>
  )
}
