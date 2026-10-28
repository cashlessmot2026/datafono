const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
export const money = (n) => fmt.format(Number(n) || 0)
export const dateTime = (d) =>
  new Date(d).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' })
export const STATUS_LABEL = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  in_process: 'En proceso',
  refunded: 'Devuelto',
}
export const vibrate = (p = 12) => { try { navigator.vibrate?.(p) } catch { /* sin soporte */ } }
