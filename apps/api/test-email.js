/* One-shot SMTP test. Run with: node test-email.js */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Minimal .env loader (avoid dotenv dependency).
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const TO = 'somnangauth@gmail.com';

(async () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.error('Missing SMTP_USER / SMTP_PASS in .env');
    process.exit(1);
  }

  // .env has SMTP_HOST=smtp.example.com (placeholder).
  // Override to Gmail since SMTP_USER is a @gmail.com address with an app password.
  const host = 'smtp.gmail.com';
  const port = 587;
  const secure = false;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass: pass.replace(/\s+/g, '') }, // Gmail app passwords are entered without spaces
  });

  console.log(`Connecting ${host}:${port} as ${user} ...`);
  try {
    await transporter.verify();
    console.log('SMTP verify: OK');
  } catch (err) {
    console.error('SMTP verify failed:', err.message);
    process.exit(2);
  }

  const from = process.env.SMTP_FROM || `Prism <${user}>`;
  const subject = '[Prism] SMTP test ' + new Date().toISOString();
  const text = 'This is a test email from the Prism API SMTP configuration.\nIf you received this, delivery works.';
  const html = `<p>This is a test email from the <strong>Prism API</strong> SMTP configuration.</p>
<p>Sent at <code>${new Date().toISOString()}</code>.</p>`;

  try {
    const info = await transporter.sendMail({ from, to: TO, subject, text, html });
    console.log('Sent. messageId =', info.messageId);
    console.log('accepted =', info.accepted);
    console.log('rejected =', info.rejected);
    console.log('response =', info.response);
  } catch (err) {
    console.error('Send failed:', err.message);
    process.exit(3);
  }
})();
