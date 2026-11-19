const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

const DATA_DIR = path.join(__dirname, "data");
const RECIPES_FILE = path.join(DATA_DIR, "recipes.json");
const REQUEST_TIMEOUT_MS = 12000;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

let recipes = readJSON(RECIPES_FILE, {});

// Нормализация названий
function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

// Порядок ингредиентов не имеет значения
function pairKey(a, b) {
  return [normalize(a), normalize(b)].sort().join("|");
}

function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

// Главная инструкция алхимическому ИИ
function craftPrompt(nameA, nameB) {
  return `Ты — игровой алхимический движок Infinite Alchemy.

Твоя задача — создавать один интересный, логичный и узнаваемый результат из двух сущностей.

ПРАВИЛА:

1. Используй смысл ингредиентов, а не их буквенные части.
2. НИКОГДА не склеивай названия ингредиентов.
3. Не создавай случайные слова, псевдоназвания, бессмыслицу.
4. Результат должен быть реальной узнаваемой сущностью, явлением, предметом, существом, местом или понятием.
5. Используй физические реакции, природные явления, ассоциации, мифологию, культуру, метафоры или юмор.
6. Не возвращай один из ингредиентов без веской причины.
7. Результат должен быть коротким, желательно 1-2 слова.
8. Максимальная длина названия — 24 символа.
9. Используй русский язык, если у сущности есть обычное русское название.
10. Не используй Undefined, Null, Unknown, Error, Failed и подобные технические заглушки.
11. Не добавляй приставки и суффиксы просто ради создания нового слова.
12. Порядок ингредиентов не имеет значения.
13. Не пытайся просто соединить два названия в одно.
14. Выбирай интересный результат, но связь должна быть объяснима.
15. Если комбинация необычная, используй творческую ассоциацию, а не случайную генерацию.

ПРИМЕРЫ:

Вода + Огонь = Пар
Вода + Земля = Грязь
Огонь + Земля = Лава
Песок + Огонь = Стекло
Снег + Солнце = Лужа
Облако + Электричество = Молния
Кот + Интернет = Мем
Луна + Волк = Оборотень
Рыба + Человек = Русалка
Кофе + Космос = Чёрная дыра
Лава + Вода = Камень
Дерево + Молния = Пожар

ПРИОРИТЕТ:

Реальная логика > устойчивая ассоциация > творческая связь > юмор.

Отвечай исключительно JSON без пояснений:

{"name":"Название результата","emoji":"Подходящий emoji"}

Ингредиенты:
${JSON.stringify(String(nameA).trim())} + ${JSON.stringify(String(nameB).trim())}`;
}

// Проверка ответа модели
function extractResult(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);

  if (!match) {
    throw new Error("Модель не вернула JSON");
  }

  const obj = JSON.parse(match[0]);

  const name = String(obj.name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);

  const emoji = String(obj.emoji || "✨").trim().slice(0, 4);

  if (!name) {
    throw new Error("Пустое название результата");
  }

  if (/undefined|null|unknown|error|failed/i.test(name)) {
    throw new Error("Недопустимое название результата");
  }

  if (
    name.length < 2 ||
    (/^[a-z0-9]+$/i.test(name) && name.length > 18)
  ) {
    throw new Error("Подозрительное название результата");
  }

  return {
    name,
    emoji: emoji || "✨",
    id: slug(name)
  };
}

// Таймаут запроса
async function requestWithTimeout(url, options) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// Groq — основной провайдер, если ключ настроен
async function groqCombine(nameA, nameB) {
  if (!GROQ_KEY) {
    throw new Error("Groq key not configured");
  }

  const res = await requestWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: craftPrompt(nameA, nameB)
          }
        ],
        temperature: 0.85,
        max_tokens: 100,
        response_format: {
          type: "json_object"
        }
      })
    }
  );

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`Groq HTTP ${res.status}: ${raw.slice(0, 180)}`);
  }

  const data = JSON.parse(raw);

  return {
    ...extractResult(data?.choices?.[0]?.message?.content),
    provider: "groq",
    model: "llama-3.3-70b-versatile"
  };
}

// Gemini — резервный провайдер или единственный
async function geminiCombine(nameA, nameB) {
  if (!GEMINI_KEY) {
    throw new Error("Gemini key not configured");
  }

  const models = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest"
  ];

  let lastErr;

  for (const model of models) {
    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

      const res = await requestWithTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: craftPrompt(nameA, nameB)
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 100,
            responseMimeType: "application/json"
          }
        })
      });

      const raw = await res.text();

      if (!res.ok) {
        lastErr = new Error(
          `Gemini ${model} HTTP ${res.status}: ${raw.slice(0, 180)}`
        );
        continue;
      }

      const data = JSON.parse(raw);

      const content =
        data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return {
        ...extractResult(content),
        provider: "gemini",
        model
      };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Gemini failed");
}

// Переключение между провайдерами
async function generateRecipe(a, b) {
  let groqError;

  if (GROQ_KEY) {
    try {
      return await groqCombine(a, b);
    } catch (e) {
      groqError = e;
      console.warn("Groq failed; trying Gemini:", e.message);
    }
  } else {
    console.warn("Groq API key missing; skipping Groq.");
  }

  if (GEMINI_KEY) {
    try {
      return await geminiCombine(a, b);
    } catch (e) {
      throw new Error(
        `Groq/Gemini unavailable. ${
          groqError ? groqError.message + " | " : ""
        }${e.message}`
      );
    }
  }

  throw new Error(
    GROQ_KEY
      ? "Both AI providers unavailable or not configured."
      : "No API keys configured. Add GEMINI_API_KEY."
  );
}

// Express
const app = express();

app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use(express.static(__dirname));

// Проверка сервера
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ai: Boolean(GROQ_KEY || GEMINI_KEY),
    groq: Boolean(GROQ_KEY),
    gemini: Boolean(GEMINI_KEY),
    recipes: Object.keys(recipes).length
  });
});

// Получение рецептов
app.get("/api/recipes", (_req, res) => {
  res.json({ recipes });
});

// Комбинация элементов
app.post("/api/combine", async (req, res) => {
  try {
    const a = req.body?.a || {};
    const b = req.body?.b || {};

    const nameA = String(a.name || a.id || "")
      .trim()
      .replace(/\s+/g, " ");

    const nameB = String(b.name || b.id || "")
      .trim()
      .replace(/\s+/g, " ");

    const idA = normalize(a.id || nameA);
    const idB = normalize(b.id || nameB);

    if (!idA || !idB || !nameA || !nameB) {
      return res.status(400).json({
        error: "Need two elements"
      });
    }

    const key = pairKey(idA, idB);

    // Если рецепт уже существует — не вызываем ИИ
    if (recipes[key]) {
      return res.json({
        result: recipes[key],
        cached: true,
        ai: Boolean(GROQ_KEY || GEMINI_KEY),
        provider: "cache"
      });
    }

    // Получаем результат от ИИ
    const invented = await generateRecipe(nameA, nameB);

    const result = {
      id:
        invented.id +
        "_" +
        crypto.createHash("md5")
          .update(key)
          .digest("hex")
          .slice(0, 6),
      name: invented.name,
      emoji: invented.emoji
    };

    // Сохраняем только успешный результат
    recipes[key] = result;

    writeJSON(RECIPES_FILE, recipes);

    res.json({
      result,
      cached: false,
      ai: true,
      provider: invented.provider,
      model: invented.model
    });
  } catch (e) {
    console.error("Combine error:", e);

    // При ошибке не создаём мусорный рецепт
    res.status(502).json({
      error: "AI_FAIL",
      message: String(e.message || e)
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `[alchemy] http://127.0.0.1:${PORT} ` +
    `groq=${Boolean(GROQ_KEY)} ` +
    `gemini=${Boolean(GEMINI_KEY)}`
  );
});
//api/health