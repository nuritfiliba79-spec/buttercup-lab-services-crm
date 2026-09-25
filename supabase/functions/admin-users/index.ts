// Admin-only user management. Runs with the service role; every call is checked
// against the caller's profile, so only role = 'admin' gets through.
//
// POST { action: 'list' }
// POST { action: 'create', email, full_name, role, lab_id?, client_id? }  -> { user, password }
// POST { action: 'update', id, role, lab_id?, client_id?, full_name? }
// POST { action: 'reset_password', id }                                   -> { password }
// POST { action: 'delete', id }
import { createClient } from 'npm:@supabase/supabase-js@2'

const ROLES = ['admin', 'lab_manager', 'technician', 'client']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// Readable initial password: Init-XXXXXXXX7 (letters + digits, no look-alikes)
function initialPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return 'Init-' + Array.from(bytes, (b) => chars[b % chars.length]).join('') + '7'
}

function assignment(body: Record<string, unknown>) {
  const role = String(body.role ?? '')
  if (!ROLES.includes(role)) throw new HttpError(400, 'תפקיד לא תקין')
  const lab_id = role === 'technician' ? (body.lab_id as string) || null : null
  const client_id = role === 'client' ? (body.client_id as string) || null : null
  if (role === 'technician' && !lab_id) throw new HttpError(400, 'יש לבחור מעבדה למבצע הבדיקות')
  if (role === 'client' && !client_id) throw new HttpError(400, 'יש לבחור חברה ללקוח')
  return { role, lab_id, client_id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    // Who is calling?
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: caller } = await admin.auth.getUser(token)
    if (!caller?.user) throw new HttpError(401, 'נדרשת התחברות')
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', caller.user.id).single()
    if (callerProfile?.role !== 'admin') throw new HttpError(403, 'הפעולה מותרת למנהל מערכת בלבד')

    const body = await req.json()

    switch (body.action) {
      case 'list': {
        const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
        if (error) throw error
        const { data: profiles } = await admin.from('profiles')
          .select('id, role, full_name, must_change_password, lab_id, client_id, lab:labs(name), client:clients(name)')
        const byId = new Map((profiles ?? []).map((p) => [p.id, p]))
        const users = data.users.map((u) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          ...byId.get(u.id),
        }))
        return json({ users })
      }

      case 'create': {
        const email = String(body.email ?? '').trim().toLowerCase()
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'כתובת מייל לא תקינה')
        const a = assignment(body)
        const password = initialPassword()
        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { full_name: body.full_name ?? null },
          app_metadata: { role: a.role, must_change_password: true },
        })
        if (error) throw new HttpError(400, error.message.includes('already') ? 'המייל כבר רשום במערכת' : error.message)
        const { error: pErr } = await admin.from('profiles')
          .update({ role: a.role, lab_id: a.lab_id, client_id: a.client_id, full_name: body.full_name || null, must_change_password: true })
          .eq('id', data.user.id)
        if (pErr) throw pErr
        return json({ user: { id: data.user.id, email }, password })
      }

      case 'update': {
        const a = assignment(body)
        if (body.id === caller.user.id && a.role !== 'admin') throw new HttpError(400, 'אי אפשר להסיר הרשאות מנהל מעצמך')
        await admin.auth.admin.updateUserById(body.id, { app_metadata: { role: a.role } })
        const { error } = await admin.from('profiles')
          .update({ role: a.role, lab_id: a.lab_id, client_id: a.client_id, full_name: body.full_name || null })
          .eq('id', body.id)
        if (error) throw error
        return json({ ok: true })
      }

      case 'reset_password': {
        const password = initialPassword()
        const { error } = await admin.auth.admin.updateUserById(body.id, {
          password, app_metadata: { must_change_password: true },
        })
        if (error) throw error
        await admin.from('profiles').update({ must_change_password: true }).eq('id', body.id)
        return json({ password })
      }

      case 'delete': {
        if (body.id === caller.user.id) throw new HttpError(400, 'אי אפשר למחוק את המשתמש שלך')
        const { error } = await admin.auth.admin.deleteUser(body.id)
        if (error) throw error
        return json({ ok: true })
      }

      default:
        throw new HttpError(400, 'פעולה לא מוכרת')
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    return json({ error: err instanceof Error ? err.message : String(err) }, status)
  }
})
