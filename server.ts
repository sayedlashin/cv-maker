import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
// @ts-ignore
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  app.use(express.json());

  // API endpoint for CV extraction
  app.post("/api/extract-cv", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let text = "";
      const buffer = req.file.buffer;
      const mimetype = req.file.mimetype;

      if (mimetype === "application/pdf") {
        const data = await pdf(buffer);
        text = data.text;
      } else if (
        mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mimetype === "application/msword"
      ) {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else {
        text = buffer.toString("utf-8");
      }

      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "Could not extract text from file" });
      }

      // Use Gemini to structure the text
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Extract the following CV data into a structured JSON format in Arabic. 
        If the data is in English, translate it to Arabic.
        Ensure it matches the following schema:
        - name: full name
        - title: professional title
        - contact: { email, phone, location, linkedin, website }
        - summary: professional summary
        - experience: list of { company, position, period, description (as array of points) }
        - education: list of { institution, degree, period, location }
        - skills: list of strings
        - languages: list of { language, level }

        CV Text:
        ${text}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              title: { type: Type.STRING },
              contact: {
                type: Type.OBJECT,
                properties: {
                  email: { type: Type.STRING },
                  phone: { type: Type.STRING },
                  location: { type: Type.STRING },
                  linkedin: { type: Type.STRING },
                  website: { type: Type.STRING },
                }
              },
              summary: { type: Type.STRING },
              experience: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    company: { type: Type.STRING },
                    position: { type: Type.STRING },
                    period: { type: Type.STRING },
                    description: { type: Type.ARRAY, items: { type: Type.STRING } }
                  }
                }
              },
              education: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    institution: { type: Type.STRING },
                    degree: { type: Type.STRING },
                    period: { type: Type.STRING },
                    location: { type: Type.STRING }
                  }
                }
              },
              skills: { type: Type.ARRAY, items: { type: Type.STRING } },
              languages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    language: { type: Type.STRING },
                    level: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      });

      const extractedData = JSON.parse(response.text || "{}");
      res.json(extractedData);
    } catch (error) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: "Failed to extract CV data" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
