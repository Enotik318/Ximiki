const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const DATA_DIR = path.join(__dirname, "data");
const RECIPES_FILE = path.join(DATA_DIR, "recipes.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJSON(file, value) {
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
}

let recipes = readJSON(RECIPES_FILE, {});

function pairKey(a, b) {
  return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join("|");
}
function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

async function geminiCombine(nameA, nameB) {
  if (!GEMINI_KEY) {
    const err = new Error("NO_KEY");
    err.code = "NO_KEY";
    throw err;
  }

  const prompt =
    'You are the Infinite Craft game engine. Combine two elements into ONE new element.\n' +
    'Return ONLY valid JSON: {"name":"Short Name","emoji":"🔥"}\n' +
    "Rules: English name, 1-2 words, creative like Infinite Craft, single emoji, no explanation.\n" +
    `Combine: "${nameA}" + "${nameB}"`;

  // try flash first, then fallback model id
  const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];
  let lastErr = null;

  for (const model of models) {
    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
        encodeURIComponent(GEMINI_KEY);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 80 },
        }),
      });
      const raw = await res.text();
      if (!res.ok) {
        lastErr = new Error(`Gemini ${model} HTTP ${res.status}: ${raw.slice(0, 200)}`);
        continue;
      }
      const data = JSON.parse(raw);
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) {
        lastErr = new Error("No JSON in model reply");
        continue;
      }
      const obj = JSON.parse(m[0]);
      if (!obj.name || !obj.emoji) {
        lastErr = new Error("Bad fields");
        continue;
      }
      return {
        name: String(obj.name).slice(0, 24),
        emoji: String(obj.emoji).slice(0, 4),
        id: slug(obj.name),
        source: "gemini",
        model,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Gemini failed");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ai: Boolean(GEMINI_KEY),
    recipes: Object.keys(recipes).length,
  });
});

app.get("/api/recipes", (_req, res) => {
  res.json({ recipes });
});

app.post("/api/combine", async (req, res) => {
  try {
    const a = req.body?.a || {};
    const b = req.body?.b || {};
    const idA = String(a.id || a.name || "").trim();
    const idB = String(b.id || b.name || "").trim();
    const nameA = String(a.name || idA).trim();
    const nameB = String(b.name || idB).trim();
    if (!idA || !idB || !nameA || !nameB) {
      return res.status(400).json({ error: "Need two elements" });
    }

    const key = pairKey(idA, idB);
    if (recipes[key]) {
      return res.json({ result: recipes[key], cached: true, ai: Boolean(GEMINI_KEY) });
    }

    const invented = await geminiCombine(nameA, nameB);
    const result = {
      id: invented.id + "_" + crypto.createHash("md5").update(key).digest("hex").slice(0, 6),
      name: invented.name,
      emoji: invented.emoji,
    };
    recipes[key] = result;
    writeJSON(RECIPES_FILE, recipes);
    res.json({ result, cached: false, ai: true, model: invented.model });
  } catch (e) {
    if (e && e.code === "NO_KEY") {
      return res.status(503).json({ error: "NO_KEY", message: "GEMINI_API_KEY not set on server" });
    }
    console.error(e);
    res.status(502).json({ error: "AI_FAIL", message: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`[alchemy] http://127.0.0.1:${PORT} ai=${Boolean(GEMINI_KEY)}`);
});
