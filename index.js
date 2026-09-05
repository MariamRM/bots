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

// نخزن نشاط المستخدمين مؤقتًا
const users = new Map();

const blockedWords = [
  "badword1",
  "badword2"
];

const blockedDomains = [
  "scam.com",
  "badsite.com"
];

// مهم: نحتاج raw body عشان نتحقق من توقيع LINE
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
      const results = await Promise.allSettled(body.events.map(handleEvent));
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

async function handleEvent(event) {
  if (event?.type !== "message") return;
  if (event.message?.type !== "text") return;
  if (typeof event.message.text !== "string") return;

  const text = event.message.text;
  const userId = event.source?.userId;

  if (!userId) return;

  const now = Date.now();

  let user = users.get(userId);

  if (!user) {
    user = {
      messages: [],
      warnings: 0,
      riskScore: 0
    };
  }

  user.messages.push({
    text,
    time: now
  });

  // نخلي فقط الرسائل بآخر 10 ثواني
  user.messages = user.messages.filter(
    message => now - message.time <= 10000
  );

  let reason = null;
  let points = 0;

  // Flood
  if (user.messages.length >= 6) {
    reason = "Flood detected";
    points += 3;
  }

  // نفس الرسالة مكررة
  const duplicateCount = user.messages.filter(
    message => message.text === text
  ).length;

  if (duplicateCount >= 4) {
    reason = "Repeated spam";
    points += 3;
  }

  // كلمات ممنوعة
  const lowerText = text.toLowerCase();

  for (const word of blockedWords) {
    if (lowerText.includes(word.toLowerCase())) {
      reason = "Blocked word";
      points += 2;
    }
  }

  // روابط
  const links = text.match(/https?:\/\/[^\s]+/gi) || [];

  for (const link of links) {
    for (const domain of blockedDomains) {
      if (link.toLowerCase().includes(domain.toLowerCase())) {
        reason = "Suspicious link";
        points += 5;
      }
    }
  }

  if (!reason) {
    users.set(userId, user);
    return;
  }

  user.warnings++;
  user.riskScore += points;

  users.set(userId, user);

  await replyMessage(
    event.replyToken,
    `⚠️ Avi Protection Alert

Reason: ${reason}
Warnings: ${user.warnings}
Risk Score: ${user.riskScore}`
  );

  console.log({
    userId,
    reason,
    warnings: user.warnings,
    riskScore: user.riskScore
  });
}

async function replyMessage(replyToken, text) {
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
        messages: [
          {
            type: "text",
            text
          }
        ]
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
