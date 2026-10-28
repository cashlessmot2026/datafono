import { useCallback, useEffect, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { supabase } from './lib/supabase'
import { isNative } from './lib/api'
import Terminal from './screens/Terminal'
import Charge from './screens/Charge'
import Result from './screens/Result'
import Admin from './screens/Admin'

// Lee los parámetros con los que Mercado Pago devuelve a la app tras el cobro
function readReturnParams(url) {
  const u = new URL(url)
  const tx = u.searchParams.get('tx')
  if (!tx) return null
  return {
    tx_id: tx,
    payment_id: u.searchParams.get('payment_id') || u.searchParams.get('collection_id') || undefined,
    result_status: u.searchParams.get('result_status') || undefined,
    error: u.searchParams.get('error') || undefined,
    error_detail: u.searchParams.get('error_detail') || undefined,
  }
}

export default function App() {
  const [screen, setScreen] = useState(() => {
    const back = readReturnParams(location.href)
    return back ? { name: 'result', params: back } : { name: 'terminal' }
  })
  const [settings, setSettings] = useState(null)

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle()
    if (data) setSettings(data)
  }, [])

  useEffect(() => {
    loadSettings()
    if (location.search) history.replaceState(null, '', location.pathname)
    if (!isNative()) return
    const open = (url) => {
      const params = url && readReturnParams(url.replace(/^datafono:\/\//, 'https://app/'))
      if (params) setScreen({ name: 'result', params })
    }
    CapApp.getLaunchUrl().then((r) => open(r?.url))
    const sub = CapApp.addListener('appUrlOpen', ({ url }) => open(url))
    return () => { sub.then((s) => s.remove()) }
  }, [loadSettings])

  const home = () => setScreen({ name: 'terminal' })

  switch (screen.name) {
    case 'charge':
      return <Charge charge={screen.charge} onDone={(params) => setScreen({ name: 'result', params })} onCancel={home} />
    case 'result':
      return <Result params={screen.params} onNew={home} />
    case 'admin':
      return <Admin onExit={() => { loadSettings(); home() }} />
    default:
      return (
        <Terminal
          settings={settings}
          onCharge={(charge) => setScreen({ name: 'charge', charge })}
          onAdmin={() => setScreen({ name: 'admin' })}
        />
      )
  }
}
