import { spawn } from 'child_process';
import 'dotenv/config';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN is missing in .env');
  process.exit(1);
}

function startTunnel() {
  console.log('Starting SSH tunnel via localhost.run...');

  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-R', '80:localhost:3000',
    'nokey@localhost.run'
  ]);

  let buffer = '';

  ssh.stdout.on('data', (data) => {
    const chunk = data.toString();
    console.log('[SSH Output]:', chunk.trim());

    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop(); // keep last incomplete line

    for (const line of lines) {
      const match = line.match(/(https:\/\/[a-z0-9]+\.lhr\.life)/);
      if (match) {
        const tunnelUrl = match[1];
        console.log(`Detected active tunnel URL: ${tunnelUrl}`);
        registerWebhook(tunnelUrl);
      }
    }
  });

  ssh.stderr.on('data', (data) => {
    console.error('[SSH Error]:', data.toString().trim());
  });

  ssh.on('close', (code) => {
    console.log(`SSH tunnel connection closed with code ${code}. Reconnecting in 5 seconds...`);
    setTimeout(startTunnel, 5000);
  });
}

async function registerWebhook(url) {
  const webhookUrl = `${url}/webhook/telegram/${botToken}`;
  try {
    console.log(`Registering Telegram Webhook to: ${webhookUrl}`);
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl })
    });
    const json = await res.json();
    console.log('Telegram Webhook Registration Response:', json);
  } catch (err) {
    console.error('Failed to register webhook with Telegram:', err.message);
  }
}

startTunnel();
