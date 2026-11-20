const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

app.use(cors({
  origin: [
    'https://enotik318.github.io',
    'https://ximiki.onrender.com'
  ]
}));

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'NEXUS',
    aiConfigured: Boolean(GEMINI_API_KEY)
  });
});

app.post('/api/gemini-test', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY не настроен на Render.'
    });
  }

  const prompt = req.body?.prompt || 'Привет! Представься как AI NEXUS.';

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API error:', data);
      return res.status(response.status).json({
        error: data?.error?.message || 'Ошибка Gemini API'
      });
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('');

    res.json({
      reply: reply || 'Gemini вернул пустой ответ.'
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Ошибка сервера при запросе к Gemini.'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NEXUS running on port ${PORT}`);
});