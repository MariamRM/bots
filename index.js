if (!process.env.DENO_DEPLOY) {
  require("dotenv").config({ quiet: true });
}

const express = require("express");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

for (const [name, value] of Object.entries({ CHANNEL_ACCESS_TOKEN, CHANNEL_SECRET })) {
  if (!value || /^YOUR_/i.test(value)) {
    throw new Error(`Set ${name} in .env locally or in Deno Deploy environment secrets.`);
  }
}

const { createModeration } = require('./moderation');
const moderation = createModeration({ reply: replyMessage, api: lineApi });
const { createReaderLink, validRequest } = require('./reader-link');
const readerLink = createReaderLink();

app.post('/reader/resolve', express.raw({ type: 'application/json', limit: '2kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Avi-Reader-Version', '1');
  if (!validRequest(req.body, req.headers['x-avi-reader-time'], req.headers['x-avi-reader-signature'], CHANNEL_ACCESS_TOKEN)) return res.sendStatus(401);
  let id;
  try { id = JSON.parse(req.body.toString()).messageId; } catch { return res.sendStatus(400); }
  if (typeof id !== 'string' || !/^\d{1,30}$/.test(id)) return res.sendStatus(400);
  try {
    const value = await readerLink.resolve(id);
    return value ? res.json(value) : res.sendStatus(404);
  } catch { return res.sendStatus(503); }
});

async function lineApi(path) {
  const response = await fetch('https://api.line.me/v2/bot' + path, {
    headers: { Authorization: 'Bearer ' + CHANNEL_ACCESS_TOKEN },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('LINE API request failed: ' + response.status);
  return response.json();
}

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
      const signature = req.headers["x-line-signature"];

      const expectedSignature = crypto
        .createHmac("sha256", CHANNEL_SECRET)
        .update(req.body)
        .digest("base64");

      const received = Buffer.from(typeof signature === "string" ? signature : "");
      const expected = Buffer.from(expectedSignature);
      if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
        console.log("Invalid LINE signature");
        return res.sendStatus(401);
      }

      let body;
      try {
        body = JSON.parse(req.body.toString());
      } catch {
        return res.sendStatus(400);
      }
      if (!body || !Array.isArray(body.events)) return res.sendStatus(400);

      // Complete replies before ending the request in a serverless runtime.
      const results = await Promise.allSettled(body.events.flatMap(event => [moderation.handle(event), readerLink.observe(event)]));
      for (const result of results) {
        if (result.status === "rejected") console.error("LINE event processing failed");
      }
      res.sendStatus(200);
    } catch (error) {
      console.error("Webhook processing failed");
      if (!res.headersSent) res.sendStatus(500);
    }
  }
);

app.get("/", (req, res) => {
  res.send("Avi Protection Bot is running ✅");
});

async function replyMessage(replyToken, text) {
  const messages = typeof text === 'string' ? [{ type: 'text', text }] : Array.isArray(text) ? text : [text];
  const response = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        replyToken,
        messages
      })
    }
  );

  if (!response.ok) {
    console.error(
      "LINE reply error:",
      response.status
    );
  }
}

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Avi Protection Bot started on port ${PORT}`);
  });
}

module.exports = { app };
