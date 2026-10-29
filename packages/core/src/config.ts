import { z } from 'zod';

export const originInput = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  }, 'Expected an HTTP(S) origin without a path, query, or credentials')
  .transform((value) => new URL(value).origin);

export function parseEnvironment(source: NodeJS.ProcessEnv) {
  return z
    .object({
      DATABASE_URL: z
        .url()
        .refine(
          (value) => /^postgres(ql)?:/.test(value),
          'Expected a PostgreSQL URL',
        ),
      API_HOST: z.string().default('127.0.0.1'),
      API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      ADMIN_ORIGIN: originInput.default('http://localhost:5173'),
      BETTER_AUTH_SECRET: z.string().min(32),
      ADMIN_AUTH_SECRET: z.string().min(32),
      RESEND_API_KEY: z.string().trim().optional(),
      GOOGLE_MAPS_API_KEY: z.string().trim().optional(),
      CRON_SECRET: z.string().min(32).optional(),
      EMAIL_FROM: z.string().trim().optional(),
    })
    .superRefine((values, ctx) => {
      if (
        !values.ADMIN_AUTH_SECRET ||
        values.ADMIN_AUTH_SECRET === values.BETTER_AUTH_SECRET
      )
        ctx.addIssue({
          code: 'custom',
          path: ['ADMIN_AUTH_SECRET'],
          message:
            'Set a separate administrator auth secret (at least 32 characters)',
        });
      if (
        source.NODE_ENV === 'production' &&
        (!source.ADMIN_ORIGIN ||
          !values.ADMIN_ORIGIN.startsWith('https://') ||
          ['localhost', '127.0.0.1', '[::1]'].includes(
            new URL(values.ADMIN_ORIGIN).hostname,
          ))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['ADMIN_ORIGIN'],
          message: 'Set an explicit public HTTPS administrator origin',
        });
      if (source.NODE_ENV !== 'production') return;
      if (!values.RESEND_API_KEY || !values.EMAIL_FROM)
        ctx.addIssue({
          code: 'custom',
          message: 'Production auth requires RESEND_API_KEY and EMAIL_FROM',
        });
      for (const name of [
        'BETTER_AUTH_SECRET',
        'ADMIN_AUTH_SECRET',
        'CRON_SECRET',
      ] as const)
        if (values[name]?.startsWith('replace-with-'))
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: 'Replace example secrets before deploying',
          });
      if (source.VERCEL === '1' && !values.CRON_SECRET)
        ctx.addIssue({
          code: 'custom',
          path: ['CRON_SECRET'],
          message:
            'The backend deployment requires CRON_SECRET for scheduled jobs',
        });
    })
    .parse(source);
}
