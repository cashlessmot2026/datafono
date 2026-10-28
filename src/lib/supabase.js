import { createClient } from '@supabase/supabase-js'

// La anon key es pública por diseño; la seguridad la dan las políticas RLS.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://btjbmdxoyhjbtdesxjrz.supabase.co'
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0amJtZHhveWhqYnRkZXN4anJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMDIzMDAsImV4cCI6MjEwMjU3ODMwMH0.FTonjwzKlsOIKTc7fchov1I6C8zpsuNlvUiLSl99u6M'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
