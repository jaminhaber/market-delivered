import type { AstroGlobal } from 'astro';
import { marketApi, messageFor } from './market';

export type AdminApi = ReturnType<typeof marketApi>;

type AdminRequest = {
  api: AdminApi | null;
  authorized: boolean;
  error: string;
  response?: Response;
};

export async function adminRequest(
  context: Pick<AstroGlobal, 'request' | 'url' | 'response' | 'redirect'>,
): Promise<AdminRequest> {
  context.response.headers.set('Cache-Control', 'no-store');
  context.response.headers.set('Referrer-Policy', 'same-origin');
  try {
    const api = marketApi(context);
    const me = await api.me.query();
    if (!me)
      return {
        api: null,
        authorized: false,
        error: '',
        response: context.redirect('/account', 303),
      };
    if (!me.admin) {
      context.response.status = 403;
      return {
        api: null,
        authorized: false,
        error: 'Administrator access is required.',
      };
    }
    if (
      context.request.method === 'POST' &&
      context.request.headers.get('origin') !== context.url.origin
    )
      return {
        api: null,
        authorized: false,
        error: '',
        response: new Response('Origin not allowed', {
          status: 403,
          headers: { 'Cache-Control': 'no-store' },
        }),
      };
    return { api, authorized: true, error: '' };
  } catch (problem) {
    return { api: null, authorized: false, error: messageFor(problem) };
  }
}

export async function adminForm(request: Request, allowedIntents: string[]) {
  const form = await request.formData();
  const field = (name: string) => String(form.get(name) || '');
  const numeric = (name: string) => Number(field(name));
  const cents = (name: string) => Math.round(numeric(name) * 100);
  const minute = (name: string) => {
    const [hours, minutes] = field(name).split(':').map(Number);
    return hours! * 60 + minutes!;
  };
  const intent = field('intent');
  if (!allowedIntents.includes(intent))
    throw new Error('Choose a valid action.');
  return { form, field, numeric, cents, minute, intent };
}
