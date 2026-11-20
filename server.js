
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Основная модель и запасные модели
const MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash'
];

app.use(cors({
  origin: [
    'https://enotik318.github.io',
    'https://ximiki.onrender.com'
  ]
}));

app.use(express.json({ limit: '1mb' }));

// Проверка сервера
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'NEXUS',
    aiConfigured: Boolean(GEMINI_API_KEY)
  });
});

// Запрос к Gemini
async function askGemini(model, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        }),
        signal: controller.signal
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(
        data?.error?.message || 'Ошибка Gemini API'
      );

      error.status = response.status;
      throw error;
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('');

    if (!reply) {
      throw new Error('Модель вернула пустой ответ.');
    }

    return reply;

  } finally {
    clearTimeout(timeout);
  }
}

// AI endpoint
app.post('/api/gemini-test', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY не настроен на Render.'
    });
  }

  const prompt = req.body?.prompt || 'Привет! Представься как AI NEXUS.';

  let lastError;

  for (const model of MODELS) {
    try {
      console.log(`NEXUS: пробуем модель ${model}`);

      const reply = await askGemini(model, prompt);

      console.log(`NEXUS: успешно ответила ${model}`);

      return res.json({
        reply,
        model
      });

    } catch (error) {
      lastError = error;

      console.error(
        `Модель ${model} не сработала:`,
        error.status || error.message
      );

      // Ошибки конфигурации и неправильного запроса
      // не имеет смысла обходить другими моделями
      if (
        error.status === 400 ||
        error.status === 401 ||
        error.status === 403
      ) {
        return res.status(error.status).json({
          error: error.message
        });
      }
    }
  }

  console.error('Все модели NEXUS недоступны.');

  return res.status(503).json({
    error: 'Все модели AI сейчас недоступны. Попробуй ещё раз немного позже.',
    details: lastError?.message
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NEXUS running on port ${PORT}`);
});
