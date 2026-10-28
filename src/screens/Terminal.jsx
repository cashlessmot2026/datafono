import { useEffect, useRef, useState } from 'react'
import { money, vibrate } from '../lib/format'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫']
const MAX_DIGITS = 9

export default function Terminal({ settings, onCharge, onAdmin }) {
  const [digits, setDigits] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [installEvt, setInstallEvt] = useState(null)
  const [nfc] = useState(() => 'NDEFReader' in window || /Android/i.test(navigator.userAgent))
  const taps = useRef([])

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvt(e) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const amount = Number(digits || 0)
  const emailOk = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  const canCharge = amount >= 1000 && emailOk

  const press = (k) => {
    vibrate()
    if (k === '⌫') return setDigits((d) => d.slice(0, -1))
    setDigits((d) => {
      const next = (d + k).replace(/^0+/, '')
      return next.length > MAX_DIGITS ? d : next
    })
  }

  // Acceso oculto al administrador: 5 toques rápidos sobre el logo
  const secretTap = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter((t) => now - t < 2000), now]
    if (taps.current.length >= 5) { taps.current = []; vibrate([30, 40, 30]); onAdmin() }
  }

  const charge = (method) => {
    if (!canCharge) return
    vibrate(20)
    onCharge({ amount, description: description.trim() || 'Venta', customer_email: email.trim().toLowerCase(), method })
  }

  const tapEnabled = settings?.enable_tap ?? true
  const qrEnabled = settings?.enable_qr ?? true

  return (
    <main className="screen terminal">
      <header className="topbar">
        <button className="brand" onClick={secretTap} aria-label="Logo">
          <span className="brand-dot" />
          <span>{settings?.business_name ?? 'Datáfono'}</span>
        </button>
        {installEvt && (
          <button className="pill ghost" onClick={async () => { installEvt.prompt(); setInstallEvt(null) }}>
            Instalar app
          </button>
        )}
      </header>

      <section className="amount-box">
        <div className="amount-label">Valor a cobrar</div>
        <div className={`amount ${amount ? '' : 'muted'}`}>{money(amount)}</div>
        {amount > 0 && amount < 1000 && <div className="hint warn">Mínimo $1.000</div>}
      </section>

      <div className="fields">
        <input
          className="field"
          placeholder="Concepto (opcional)"
          value={description}
          maxLength={120}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          className={`field ${emailOk ? '' : 'invalid'}`}
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="Email del cliente para el comprobante"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <section className="keypad">
        {KEYS.map((k) => (
          <button
            key={k}
            className={`key ${k === '⌫' ? 'key-alt' : ''}`}
            onClick={() => press(k)}
            onContextMenu={(e) => { if (k === '⌫') { e.preventDefault(); setDigits('') } }}
          >
            {k}
          </button>
        ))}
      </section>

      <footer className="actions">
        {tapEnabled && (
          <button className="btn primary big" disabled={!canCharge} onClick={() => charge('tap')}>
            <NfcIcon /> Cobrar con tarjeta
          </button>
        )}
        {qrEnabled && (
          <button className="btn secondary big" disabled={!canCharge} onClick={() => charge('qr')}>
            <QrIcon /> QR / Link
          </button>
        )}
        {nfc === false && tapEnabled && (
          <div className="hint">Este equipo no parece tener NFC: usa QR / Link.</div>
        )}
      </footer>
    </main>
  )
}

export function NfcIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 8.5a6 6 0 0 1 0 7" /><path d="M9.5 6a10 10 0 0 1 0 12" /><path d="M13 3.5a14 14 0 0 1 0 17" />
    </svg>
  )
}

function QrIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4" />
    </svg>
  )
}
