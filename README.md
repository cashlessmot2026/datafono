# Datáfono Cashless

Terminal de cobros sin contacto: PWA instalable + APK Android, en React, con Supabase y Mercado Pago (Colombia).

- **PWA:** https://cashlessmot2026.github.io/datafono/
- **APK:** [Releases → latest](https://github.com/cashlessmot2026/datafono/releases/tag/latest) (se compila solo con cada push a `main`)

## Cómo cobra

```
Negocio digita el valor ─► PWA crea el cobro (Edge Function "datafono", tabla df_transactions)
        │
        ├─ Cobrar con tarjeta (NFC) ─► deep link a la app de Mercado Pago (Tap to Pay / Point Tap)
        │      el cliente acerca su tarjeta al celular; MP lee la tarjeta de forma certificada
        │      y regresa a la PWA/APK con payment_id ─► la función verifica el pago contra la API de MP
        │
        └─ QR / Link ─► preferencia Checkout Pro; el cliente escanea y paga; la PWA consulta el estado
                         cada 3 s (y el webhook lo actualiza si está habilitado)

Pago aprobado ─► comprobante HTML por email al cliente (Resend) ─► registro en el panel admin
```

> **Por qué no se lee la tarjeta directamente desde la PWA:** Web NFC solo lee etiquetas NDEF, no tarjetas
> EMV, y procesar tarjetas sin certificación PCI no está permitido. Por eso la lectura la hace la app oficial de Mercado Pago
> (Tap to Pay), que debe estar instalada en el mismo celular con NFC activado y la cuenta del negocio iniciada.

## Admin oculto

Toca **5 veces seguidas el logo** (arriba a la izquierda) en la pantalla de la terminal.
Solo pueden entrar los emails de la tabla `df_admin_emails` (ya está `eduth4846@gmail.com`).
La primera vez usa "crear cuenta", confirma el email y entra. Para añadir otro admin:

```sql
insert into public.df_admin_emails (email) values ('otro@correo.com');
```

El panel muestra ventas de hoy y acumuladas, la lista con filtros por estado, y los ajustes del negocio (nombre, NIT, email de respuesta, pie del comprobante, métodos activos).

## Configuración pendiente (secrets)

En Supabase → Edge Functions → Secrets
(https://supabase.com/dashboard/project/btjbmdxoyhjbtdesxjrz/functions/secrets):

| Secret | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token de **producción** de la app *Datafono Cashless* (ID 8407244842856067) en el panel de Mercado Pago |
| `RESEND_API_KEY` | API key de https://resend.com |
| `RESEND_FROM` | Remitente de un dominio verificado en Resend, ej. `Datafono <cobros@tudominio.com>` |

O con la CLI: `npx supabase secrets set MP_ACCESS_TOKEN=... RESEND_API_KEY=... --project-ref btjbmdxoyhjbtdesxjrz`

**Webhook (opcional):** para que los pagos QR se confirmen aunque se cierre la pantalla, desactiva *Verify JWT* en
Edge Functions → datafono → Settings. La URL del webhook ya va dentro de cada preferencia.

## Estructura

| Ruta | Qué es |
|---|---|
| `src/screens/Terminal.jsx` | Teclado numérico, concepto, email del cliente, botones de cobro, acceso oculto |
| `src/screens/Charge.jsx` | Espera del cobro NFC (deep link MP) o QR con consulta periódica |
| `src/screens/Result.jsx` | Verificación del pago, aprobado/rechazado, reenvío del comprobante |
| `src/screens/Admin.jsx` | Login, métricas, ventas, ajustes |
| `supabase/schema.sql` | Tablas `df_*`, RLS y funciones (idempotente) |
| `supabase/functions/datafono/index.ts` | Edge Function: create / verify / cancel / resend_email / health / webhook |
| `android/` | Proyecto Capacitor (deep link de retorno `datafono://resultado`) |
| `.github/workflows/` | Deploy a GitHub Pages y build del APK |

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # PWA en dist/
npx cap sync android # copia dist/ al proyecto Android
```

Redeploy de la función: `npx supabase functions deploy datafono --project-ref btjbmdxoyhjbtdesxjrz`
