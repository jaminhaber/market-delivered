import { z } from 'zod';

const origin = z
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Expected an HTTP(S) origin without a path, query, or credentials')
  .transform((value) => new URL(value).origin);

export function parseEnvironment(source: NodeJS.ProcessEnv) {
  return z
    .object({
      DATABASE_URL: z
        .url()
        .refine(
          (url) => /^postgres(ql)?:/.test(url),
          'Expected a PostgreSQL URL',
        ),
      API_HOST: z.string().default('127.0.0.1'),
      API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      WEB_ORIGIN: origin.default('http://localhost:5173'),
      BETTER_AUTH_SECRET: z.string().min(32),
      BETTER_AUTH_URL: origin.default('http://localhost:5173'),
      RESEND_API_KEY: z.string().trim().optional(),
      GOOGLE_MAPS_API_KEY: z.string().trim().optional(),
      CRON_SECRET: z.string().min(32).optional(),
      EMAIL_FROM: z.string().trim().optional(),
    })
    .superRefine((values, ctx) => {
      if (source.NODE_ENV !== 'production') return;
      for (const name of ['WEB_ORIGIN', 'BETTER_AUTH_URL'] as const) {
        if (
          !source[name] ||
          new URL(values[name]).protocol !== 'https:' ||
          ['localhost', '127.0.0.1', '[::1]'].includes(
            new URL(values[name]).hostname,
          )
        )
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: 'Set an explicit public HTTPS origin for production',
          });
      }
      if (!values.RESEND_API_KEY || !values.EMAIL_FROM)
        ctx.addIssue({
          code: 'custom',
          message: 'Production auth requires RESEND_API_KEY and EMAIL_FROM',
        });
      for (const name of ['BETTER_AUTH_SECRET', 'CRON_SECRET'] as const) {
        if (values[name]?.startsWith('replace-with-'))
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: 'Replace example secrets before deploying',
          });
      }
      if (source.VERCEL === '1') {
        if (values.WEB_ORIGIN !== values.BETTER_AUTH_URL)
          ctx.addIssue({
            code: 'custom',
            message:
              'Vercel auth must use the frontend origin for WEB_ORIGIN and BETTER_AUTH_URL',
          });
        if (!values.CRON_SECRET)
          ctx.addIssue({
            code: 'custom',
            path: ['CRON_SECRET'],
            message: 'Vercel requires CRON_SECRET for scheduled jobs',
          });
      }
    })
    .parse(source);
}
