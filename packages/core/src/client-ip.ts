import { getIPFromHeader, normalizeIP } from '@better-auth/core/utils/ip';

export const CLIENT_IP_HEADER = 'x-md-client-ip';

export function requestClientIp(request: {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}) {
  // Only Vercel's ingress may supply this header. Other deployments use the
  // socket address, never caller-provided forwarding headers.
  const forwarded =
    process.env.VERCEL === '1' ? request.headers['x-forwarded-for'] : undefined;
  return (
    (typeof forwarded === 'string' && getIPFromHeader(forwarded)) ||
    normalizeIP(request.ip) ||
    'unknown'
  );
}
