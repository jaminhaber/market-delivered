// Vite binds to loopback. Accept its two local hostnames on the configured port
// in development, and keep production's origin allowlist exact.
export function webOrigins(config: {
  webOrigin: string;
  production?: boolean;
}) {
  const configured = new URL(config.webOrigin);
  const origins = [configured.origin];
  if (
    !config.production &&
    ['localhost', '127.0.0.1'].includes(configured.hostname)
  ) {
    configured.hostname =
      configured.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    origins.push(configured.origin);
  }
  return origins;
}
