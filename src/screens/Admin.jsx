import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { api } from '../lib/api'
import { dateTime, money, STATUS_LABEL } from '../lib/format'

export default function Admin({ onExit }) {
  const [session, setSession] = useState(undefined)
  const [authorized, setAuthorized] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setAuthorized(null); return }
    supabase.rpc('claim_admin').then(({ data }) => setAuthorized(Boolean(data)))
  }, [session])

  if (session === undefined) return <main className="screen center"><div className="spinner" /></main>
  if (!session) return <Login onExit={onExit} />
  if (authorized === null) return <main className="screen center"><div className="spinner" /></main>
  if (!authorized) {
    return (
      <main className="screen center">
        <h2>Sin acceso</h2>
        <p className="muted">Esta cuenta no es administradora.</p>
        <button className="btn secondary" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        <button className="btn ghost" onClick={onExit}>Volver</button>
      </main>
    )
  }
  return <Dashboard onExit={onExit} />
}

function Login({ onExit }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('in')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const fn = mode === 'in' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { data, error } = await fn.call(supabase.auth, { email, password })
    setBusy(false)
    if (error) return setMsg(error.message)
    if (mode === 'up' && !data.session) setMsg('Revisa tu email para confirmar la cuenta y luego inicia sesión.')
  }

  return (
    <main className="screen center">
      <form className="card login" onSubmit={submit}>
        <h2>Administrador</h2>
        <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="field" type="password" placeholder="Contraseña" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn primary" disabled={busy}>{busy ? '…' : mode === 'in' ? 'Entrar' : 'Crear cuenta'}</button>
        <button type="button" className="btn ghost small" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Primera vez: crear cuenta de administrador' : 'Ya tengo cuenta'}
        </button>
        {msg && <div className="hint">{msg}</div>}
      </form>
      <button className="btn ghost" onClick={onExit}>Volver a la terminal</button>
    </main>
  )
}

function Dashboard({ onExit }) {
  const [tab, setTab] = useState('ventas')
  const [txs, setTxs] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(300)
    setTxs(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    api.health().then(setHealth).catch(() => setHealth({ ok: false }))
  }, [load])

  const stats = useMemo(() => {
    const today = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })
    const approved = txs.filter((t) => t.status === 'approved')
    const todays = approved.filter((t) => new Date(t.created_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) === today)
    const sum = (a) => a.reduce((s, t) => s + Number(t.amount), 0)
    return { todayTotal: sum(todays), todayCount: todays.length, total: sum(approved), count: approved.length }
  }, [txs])

  const list = filter === 'all' ? txs : txs.filter((t) => t.status === filter)

  return (
    <main className="screen admin">
      <header className="topbar">
        <h2>Panel</h2>
        <div className="row">
          <button className="pill ghost" onClick={onExit}>Terminal</button>
          <button className="pill ghost" onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </header>

      {health && (!health.mercadopago || !health.email) && (
        <div className="alert">
          {!health.ok && 'No se pudo contactar la Edge Function. '}
          {health.ok && !health.mercadopago && 'Falta el secret MP_ACCESS_TOKEN. '}
          {health.ok && !health.email && 'Falta el secret RESEND_API_KEY (emails desactivados).'}
        </div>
      )}

      <section className="stats">
        <div className="stat"><span>Hoy</span><strong>{money(stats.todayTotal)}</strong><small>{stats.todayCount} pagos</small></div>
        <div className="stat"><span>Acumulado</span><strong>{money(stats.total)}</strong><small>{stats.count} pagos</small></div>
      </section>

      <nav className="tabs">
        {['ventas', 'ajustes'].map((t) => (
          <button key={t} className={`pill ${tab === t ? 'active' : 'ghost'}`} onClick={() => setTab(t)}>
            {t === 'ventas' ? 'Ventas' : 'Ajustes'}
          </button>
        ))}
      </nav>

      {tab === 'ventas' ? (
        <>
          <div className="row filters">
            {['all', 'approved', 'pending', 'rejected', 'cancelled'].map((f) => (
              <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'Todas' : STATUS_LABEL[f]}
              </button>
            ))}
            <button className="chip" onClick={load}>{loading ? '…' : '↻'}</button>
          </div>
          <ul className="tx-list">
            {list.map((t) => (
              <li key={t.id} className="tx">
                <div>
                  <strong>{money(t.amount)}</strong>
                  <div className="muted small">{t.description} · {t.method === 'tap' ? 'NFC' : 'QR'} · {dateTime(t.created_at)}</div>
                  {t.customer_email && <div className="muted small">{t.customer_email}{t.email_sent ? ' ✉︎' : ''}</div>}
                </div>
                <span className={`status s-${t.status}`}>{STATUS_LABEL[t.status]}</span>
              </li>
            ))}
            {!list.length && <li className="muted center-text">Sin movimientos</li>}
          </ul>
        </>
      ) : (
        <Settings />
      )}
    </main>
  )
}

function Settings() {
  const [s, setS] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    supabase.from('settings').select('*').eq('id', 1).single().then(({ data }) => setS(data))
  }, [])

  if (!s) return <div className="spinner" />
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  const save = async () => {
    const { id: _id, updated_at: _u, ...patch } = s
    const { error } = await supabase.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1)
    setMsg(error ? error.message : 'Guardado')
  }

  return (
    <section className="card settings">
      <label>Nombre del negocio<input className="field" value={s.business_name} onChange={set('business_name')} /></label>
      <label>NIT<input className="field" value={s.business_nit ?? ''} onChange={set('business_nit')} /></label>
      <label>Email de respuesta<input className="field" type="email" value={s.business_email ?? ''} onChange={set('business_email')} /></label>
      <label>Pie del comprobante<input className="field" value={s.receipt_footer ?? ''} onChange={set('receipt_footer')} /></label>
      <label className="switch"><input type="checkbox" checked={s.enable_tap} onChange={set('enable_tap')} /> Cobro con tarjeta (NFC)</label>
      <label className="switch"><input type="checkbox" checked={s.enable_qr} onChange={set('enable_qr')} /> Cobro con QR / Link</label>
      <button className="btn primary" onClick={save}>Guardar</button>
      {msg && <div className="hint">{msg}</div>}
    </section>
  )
}
