import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename?: string; content: Buffer; cid: string; contentType: string }[];
}

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private fromAddress = 'UnifyOps <no-reply@unifyops.local>';
  private webOrigin = 'http://localhost:3000';
  private logoCid: { buffer: Buffer; contentType: string } | null = null;

  constructor(private cfg: ConfigService) {}

  async onModuleInit() {
    this.webOrigin = this.cfg.get<string>('WEB_ORIGIN') ?? this.webOrigin;

    // Convert logo to PNG so Gmail displays it inline (not as attachment).
    // Prefer a pre-built icon.png; fall back to converting icon.svg via sharp.
    const pngPath = join(process.cwd(), 'public', 'img', 'icon.png');
    const svgPath = join(process.cwd(), 'public', 'img', 'icon.svg');
    try {
      if (existsSync(pngPath)) {
        this.logoCid = { buffer: readFileSync(pngPath), contentType: 'image/png' };
      } else if (existsSync(svgPath)) {
        const png = await sharp(readFileSync(svgPath)).resize(96, 96).png().toBuffer();
        this.logoCid = { buffer: png, contentType: 'image/png' };
      }
    } catch {
      this.logoCid = null;
    }

    const host = this.cfg.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.log('SMTP_HOST not set — email delivery disabled (logging only)');
      return;
    }
    const port = this.cfg.get<number>('SMTP_PORT') ?? 587;
    const user = this.cfg.get<string>('SMTP_USER');
    const pass = this.cfg.get<string>('SMTP_PASS');
    const secure = this.cfg.get<boolean>('SMTP_SECURE') ?? port === 465;
    this.fromAddress =
      this.cfg.get<string>('SMTP_FROM') ?? `UnifyOps <${user ?? 'no-reply@unifyops.local'}>`;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
    this.logger.log(`Email transport configured: ${host}:${port}`);
  }

  buildLink(path?: string): string {
    if (!path) return this.webOrigin;
    return `${this.webOrigin}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async send(msg: EmailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.debug(`[email skipped] -> ${msg.to}: ${msg.subject}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments,
      });
    } catch (err) {
      this.logger.error(`Email send failed -> ${msg.to}`, err as Error);
    }
  }

  buildNotificationEmail(opts: {
    title: string;
    subject: string;
    link?: string;
  }): { subject: string; text: string; html: string } {
    const safeSubject = escapeHtml(opts.subject);
    const safeTitle = escapeHtml(opts.title);
    const url = this.buildLink(opts.link);
    const safeUrl = escapeHtml(url);
    const text = `${opts.title}\n\n${opts.subject}\n\n${url}`;
    const html = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;margin:0 auto">
        <tr><td style="padding:16px 0;font-size:12px;letter-spacing:.08em;color:#888;text-transform:uppercase">UnifyOps</td></tr>
        <tr><td style="padding-bottom:8px;font-size:18px;font-weight:600">${safeTitle}</td></tr>
        <tr><td style="padding-bottom:20px;font-size:14px;color:#444;line-height:1.55">${safeSubject}</td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="${safeUrl}" style="display:inline-block;padding:9px 16px;background:#6366f1;color:#fff;font-weight:600;font-size:14px;text-decoration:none;border-radius:6px">Open in UnifyOps</a>
        </td></tr>
        <tr><td style="border-top:1px solid #eee;padding-top:12px;font-size:11px;color:#888;line-height:1.5">
          You're receiving this because email is enabled for this notification type. Manage preferences at <a href="${this.buildLink('/settings')}" style="color:#6366f1">Settings → Notifications</a>.
        </td></tr>
      </table>
    `.trim();
    return { subject: `[UnifyOps] ${opts.title}: ${opts.subject}`, text, html };
  }

  async sendReportEmail(opts: {
    templateName: string;
    frequency: string;
    pdfBuffer: Buffer;
    recipientEmails: string[];
  }): Promise<void> {
    if (!opts.recipientEmails.length) {
      this.logger.debug(`sendReportEmail: "${opts.templateName}" — no recipient emails, skipping`);
      return;
    }
    const subject = `[Report] ${opts.templateName}`;
    const period = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const html = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;margin:0 auto">
        <tr><td style="padding:16px 0;font-size:12px;letter-spacing:.08em;color:#888;text-transform:uppercase">UnifyOps Reports</td></tr>
        <tr><td style="padding-bottom:8px;font-size:18px;font-weight:600">${escapeHtml(opts.templateName)}</td></tr>
        <tr><td style="padding-bottom:20px;font-size:14px;color:#444;line-height:1.55">Your ${opts.frequency} report for <strong>${escapeHtml(period)}</strong> is attached.</td></tr>
        <tr><td style="border-top:1px solid #eee;padding-top:12px;font-size:11px;color:#888">This is an automated report from UnifyOps.</td></tr>
      </table>
    `.trim();
    const text = `${opts.templateName}\n\nYour ${opts.frequency} report for ${period} is attached.\n\nThis is an automated report from UnifyOps.`;
    const attachment = {
      filename: `${opts.templateName.replace(/[^a-z0-9]/gi, '_')}.pdf`,
      content: opts.pdfBuffer,
      cid: 'report-pdf',
      contentType: 'application/pdf',
    };

    this.logger.log(
      `sendReportEmail: "${opts.templateName}" (${opts.frequency}) → ${opts.recipientEmails.join(', ')}`,
    );

    for (const to of opts.recipientEmails) {
      await this.send({ to, subject, text, html, attachments: [attachment] });
    }
  }

  buildInviteEmail(opts: {
    name: string;
    email: string;
    role: string;
    token: string;
  }): { subject: string; text: string; html: string; attachments: EmailMessage['attachments'] } {
    const { name, email, role, token } = opts;
    const inviteUrl = this.buildLink(
      `/accept-invite?token=${encodeURIComponent(token)}`,
    );
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeRole = escapeHtml(role);
    const safeInviteUrl = escapeHtml(inviteUrl);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const fmtOpts: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    };
    const sentStr = now.toLocaleString('en-GB', fmtOpts);
    const expiresStr = expiresAt.toLocaleString('en-GB', fmtOpts);

    const attachments: EmailMessage['attachments'] = this.logoCid
      ? [{ content: this.logoCid.buffer, cid: 'unifyops-logo', contentType: this.logoCid.contentType }]
      : [];

    const logoHtml = this.logoCid
      ? `<img src="cid:unifyops-logo" width="96" height="96" alt="UnifyOps" style="display:inline-block;width:96px;height:96px;border:0" />`
      : `<span style="font-size:22px;font-weight:800;color:#6366f1;letter-spacing:-.02em">UnifyOps</span>`;

    const text = [
      `Hello ${name},`,
      '',
      `You have been invited to join UnifyOps Workspace.`,
      '',
      `Your account details:`,
      `  Name:  ${name}`,
      `  Email: ${email}`,
      `  Role:  ${role}`,
      '',
      `Invitation sent:  ${sentStr}`,
      `Link expires:     ${expiresStr}`,
      '',
      `Accept your invitation and set your password here:`,
      `  ${inviteUrl}`,
      '',
      `If you did not expect this, you can safely ignore this email.`,
    ].join('\n');

    const html = `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:560px;margin:0 auto">
        <tr>
          <td style="padding:32px 0 20px;text-align:center">
            ${logoHtml}
          </td>
        </tr>
        <tr><td style="padding-bottom:8px;font-size:20px;font-weight:700">You're invited to UnifyOps, ${safeName}!</td></tr>
        <tr><td style="padding-bottom:20px;font-size:14px;color:#444;line-height:1.6">
          A workspace account has been created for you. Click the button below to set your password and activate your account.
        </td></tr>
        <tr><td style="padding-bottom:24px">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden">
            <tr style="background:#f9fafb">
              <td style="padding:10px 16px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e5e7eb;width:100px">Name</td>
              <td style="padding:10px 16px;font-size:14px;border-bottom:1px solid #e5e7eb">${safeName}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e5e7eb">Email</td>
              <td style="padding:10px 16px;font-size:14px;border-bottom:1px solid #e5e7eb">${safeEmail}</td>
            </tr>
            <tr style="background:#f9fafb">
              <td style="padding:10px 16px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e5e7eb">Role</td>
              <td style="padding:10px 16px;font-size:14px;text-transform:capitalize;border-bottom:1px solid #e5e7eb">${safeRole}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #e5e7eb">Sent</td>
              <td style="padding:10px 16px;font-size:13px;color:#555;border-bottom:1px solid #e5e7eb">${escapeHtml(sentStr)}</td>
            </tr>
            <tr style="background:#fff8ed">
              <td style="padding:10px 16px;font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.06em">Expires</td>
              <td style="padding:10px 16px;font-size:13px;color:#92400e;font-weight:600">${escapeHtml(expiresStr)}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding-bottom:8px;text-align:center">
          <a href="${safeInviteUrl}" style="display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;font-weight:600;font-size:15px;text-decoration:none;border-radius:8px">Accept invitation &amp; set password</a>
        </td></tr>
        <tr><td style="padding-bottom:20px;font-size:12px;color:#888;text-align:center">
          Or copy this link: <a href="${safeInviteUrl}" style="color:#6366f1;word-break:break-all">${safeInviteUrl}</a>
        </td></tr>
        <tr><td style="border-top:1px solid #eee;padding-top:12px;font-size:11px;color:#888;line-height:1.6">
          If you did not expect this invitation, you can safely ignore this email.
        </td></tr>
      </table>
    `.trim();

    return { subject: `You've been invited to UnifyOps Workspace`, text, html, attachments };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
