export type EmailConfig = {
  resendKey?: string;
  emailFrom?: string;
  appName?: string;
  emailReplyTo?: string;
  production?: boolean;
};
export function createEmailSender(config: EmailConfig) {
  return async function sendEmail(
    to: string,
    subject: string,
    url: string,
    message = subject,
  ) {
    if (!config.resendKey) {
      if (config.production)
        throw new Error('Email delivery is not configured');
      console.info(`[development email] ${subject} to ${to}: ${url}`);
      return;
    }
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:
          config.appName && config.emailFrom
            ? `"${config.appName
                .replace(/[\r\n]/g, ' ')
                .replace(/\\/g, '\\\\')
                .replace(
                  /"/g,
                  '\\"',
                )}" <${config.emailFrom.match(/<([^<>]+)>/)?.[1] || config.emailFrom}>`
            : config.emailFrom,
        ...(config.emailReplyTo ? { reply_to: config.emailReplyTo } : {}),
        to,
        subject,
        text: `${message}\n\n${url}\n\nIf you did not request this, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) throw new Error('Email delivery failed');
  };
}
