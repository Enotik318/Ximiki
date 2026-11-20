
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'NEXUS',
    aiConfigured: Boolean(GEMINI_API_KEY)
  });
});

app.post('/api/gemini-test', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'На Render не задан GEMINI_API_KEY.'
    });
  }

  const prompt =
    typeof req.body?.prompt === 'string' && req.body.prompt.trim()
      ? req.body.prompt.trim()
      : 'Коротко подтвердить связь с NEXUS.';

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        payload?.error?.message ||
        `Gemini вернул HTTP ${response.status}`;

      return res.status(response.status).json({ error: message });
    }

    const reply = payload?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: 'Gemini вернул пустой ответ.'
      });
    }

    res.json({ reply });

  } catch (error) {
    console.error('Gemini request failed:', error);

    res.status(502).json({
      error: 'Не удалось связаться с Gemini. Проверь серверные логи.'
    });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();

  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NEXUS server listening on port ${PORT}`);
});
