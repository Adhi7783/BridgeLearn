const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const multer = require('multer');
const { spawn, spawnSync } = require('child_process');
const { PDFParse } = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');

const modelManager = require('./src/modelManager');
const dataManager = require('./src/dataManager');

/**
 * BridgeLearn Backend - Offline-First AI Tutoring
 * Uses: Gemma 4 E2B (4-bit quantized) via Ollama
 * Model: bridgelearn-gemma-4-e2b-q4
 * Inference: /api/chat endpoint (local inference, optional cloud fallback)
 */

const envPath = path.join(__dirname, '..', 'config', '.env.local');
dotenv.config({ path: envPath });

const app = express();
const port = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseMetadata(rawMetadata) {
  if (!rawMetadata) return {};
  if (typeof rawMetadata === 'object') return rawMetadata;
  try {
    return JSON.parse(rawMetadata);
  } catch (err) {
    return {};
  }
}


function parseStudentIdentity(rawValue) {
  const raw = String(rawValue || '').trim();
  const bridgeCodeMatch = raw.toUpperCase().match(/STUDENT-(BRIDGE-\d{2}-\d{2})@/);
  const studentCode = bridgeCodeMatch?.[1] || (raw.toUpperCase().includes('BRIDGE-') ? raw.toUpperCase() : '');
  const studentName = raw.includes('|') ? raw.split('|')[0].trim() : raw;
  return {
    raw,
    studentName,
    studentCode,
    fallbackName: studentName
  };
}

function buildStudentIdentityLookup(roster = []) {
  const lookup = new Map();
  for (const row of roster || []) {
    const canonicalKey = String(row.studentKey || row.studentCode || row.studentName || '').trim().toLowerCase();
    const display = String(row.studentName || row.studentCode || row.studentKey || '').trim();
    for (const token of [row.studentKey, row.studentCode, row.studentName]) {
      const normalized = normalizeToken(token);
      if (normalized && !lookup.has(normalized)) {
        lookup.set(normalized, { canonicalKey, display });
      }
    }
  }
  return lookup;
}

function resolveStudentIdentity(studentId, identityLookup = new Map(), studentDirectory = new Map()) {
  const normalized = normalizeToken(studentId);
  if (normalized && identityLookup.has(normalized)) return identityLookup.get(normalized);
  if (normalized && studentDirectory.has(normalized)) {
    return { canonicalKey: normalized, display: studentDirectory.get(normalized) };
  }
  return { canonicalKey: normalized || String(studentId || '').trim().toLowerCase(), display: String(studentId || '').trim() };
}

async function resolveCanonicalProgressStudentId(sessionId, studentId) {
  const parsed = parseStudentIdentity(studentId);
  const session = await dataManager.getSessionById(sessionId);
  if (!session) return String(studentId || '').trim();

  const candidates = [parsed.studentCode, parsed.studentName, parsed.fallbackName, parsed.raw]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const match = await new Promise((resolve) => {
      dataManager.db.get(
        `SELECT studentName, studentCode, studentKey
         FROM enrollments
         WHERE curriculumId = ?
           AND (
             lower(trim(studentKey)) = lower(trim(?))
             OR lower(trim(coalesce(studentCode, ''))) = lower(trim(?))
             OR lower(trim(studentName)) = lower(trim(?))
           )
         ORDER BY created_at DESC
         LIMIT 1`,
        [session.curriculumId, candidate, candidate, candidate],
        (err, row) => (err ? resolve(null) : resolve(row || null))
      );
    });
    if (match) return String(match.studentKey || match.studentCode || match.studentName || candidate).trim();
  }
  return String(studentId || '').trim();
}

function getUploadedFile(req) {
  if (req?.file) return req.file;
  if (Array.isArray(req?.files) && req.files.length) return req.files[0];
  if (req?.files && typeof req.files === 'object') {
    const first = Object.values(req.files).flat()[0];
    if (first) return first;
  }
  return null;
}

/*
    });
    if (studentRow && studentRow.name) {
      const nameVal = String(studentRow.name || '').trim();
      const enrollmentRetry = await new Promise((resolve) => {
        dataManager.db.get(
          `SELECT studentName, studentCode, studentKey
           FROM enrollments
           WHERE curriculumId = ?
             AND (
               lower(trim(studentKey)) = lower(trim(?))
               OR lower(trim(coalesce(studentCode, ''))) = lower(trim(?))
               OR lower(trim(studentName)) = lower(trim(?))
             )
           ORDER BY created_at DESC
           LIMIT 1`,
          [session.curriculumId, nameVal, '', nameVal],
          (err, row) => {
            if (err) return resolve(null);
            resolve(row || null);
          }
        );
      });
      if (enrollmentRetry) enrollment = enrollmentRetry;
    }
  }

  // Try a relaxed match for hyphen/underscore-separated names (e.g., "student-08-01" -> "student 08 01")
  if (!enrollment) {
    const relaxed = String(rawStudentId || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (relaxed && relaxed !== rawStudentId) {
      const enrollmentRelax = await new Promise((resolve) => {
        dataManager.db.get(
          `SELECT studentName, studentCode, studentKey
           FROM enrollments
           WHERE curriculumId = ?
             AND (
               lower(trim(studentKey)) = lower(trim(?))
               OR lower(trim(coalesce(studentCode, ''))) = lower(trim(?))
               OR lower(trim(studentName)) = lower(trim(?))
             )
           ORDER BY created_at DESC
           LIMIT 1`,
          [session.curriculumId, relaxed, parsed.studentCode || '', relaxed],
          (err, row) => {
            if (err) return resolve(null);
            resolve(row || null);
          }
        );
      });
      if (enrollmentRelax) enrollment = enrollmentRelax;
    }
  }

  // If still not found, try extracting numeric id fragments and match by common studentCode pattern
  if (!enrollment) {
    const m = String(rawStudentId || '').match(/(\d{2}[-_]?\d{2})/);
    if (m && m[1]) {
      const normalizedFragment = m[1].replace('_', '-');
      const candidateCode = `BRIDGE-${normalizedFragment}`.toUpperCase();
      const enrollmentByCode = await new Promise((resolve) => {
        dataManager.db.get(
          `SELECT studentName, studentCode, studentKey FROM enrollments WHERE curriculumId = ? AND lower(trim(coalesce(studentCode,''))) = lower(trim(?)) ORDER BY created_at DESC LIMIT 1`,
          [session.curriculumId, candidateCode],
          (err, row) => { if (err) return resolve(null); resolve(row || null); }
        );
      });
      if (enrollmentByCode) enrollment = enrollmentByCode;
    }
  }

  if (!enrollment) return fallback;
  const studentName = String(enrollment.studentName || parsed.studentName || parsed.fallbackName || '').trim();
  const studentCode = String(enrollment.studentCode || parsed.studentCode || '').trim();
  if (studentName && studentCode) return `${studentName}|${studentCode}`;
  return String(enrollment.studentKey || fallback).trim();
}

*/

async function analyzePdf(filePath) {
  const pdfBuffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: pdfBuffer });
  const data = await parser.getText();
  return {
    text: (data.text || '').trim(),
    pageCount: Number(data.total || 0)
  };
}

async function rasterizePdf(filePath, outDir) {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outPrefix = path.join(outDir, 'page');
      // pdftoppm -png -r 150 input.pdf outPrefix
      const proc = spawn('pdftoppm', ['-png', '-r', '150', filePath, outPrefix]);
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`pdftoppm exited ${code}: ${stderr}`));
        }
        // collect generated files: page-1.png, page-2.png, ...
        const files = fs.readdirSync(outDir).filter((f) => f.startsWith('page-') && f.endsWith('.png')).sort();
        resolve(files.map((f) => path.join(outDir, f)));
      });
      proc.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function isCommandAvailable(commandName) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [commandName], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

async function extractTextFromPdf(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const proc = spawn('pdftotext', [filePath, '-']);
      let out = '';
      let err = '';
      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.stderr.on('data', (d) => (err += d.toString()));
      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`pdftotext exited ${code}: ${err}`));
        }
        resolve(out.trim());
      });
      proc.on('error', (e) => reject(e));
    } catch (e) {
      reject(e);
    }
  }).catch(async (err) => {
    if (String(err && err.message || '').includes('ENOENT')) {
      const fallback = await analyzePdf(filePath);
      return fallback.text;
    }
    const fallback = await analyzePdf(filePath);
    if (fallback.text) return fallback.text;
    throw err;
  });
}

app.get('/api/health', async (req, res) => {
  const status = await modelManager.getStatus();
  const healthy = status.local.available || status.cloud.available;
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    strategy: status.strategy,
    offlineOnly: status.offlineOnly,
    local: status.local,
    cloud: status.cloud,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/config', (req, res) => {
  res.json(modelManager.getConfig());
});

app.post('/api/teacher/login', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ ok: false, error: 'Email required' });
    
    // CRITICAL: Check if user exists by email first
    // Users table has the UUID, curricula are linked to that UUID
    let existingUser = await dataManager.getUserByEmail(email);
    
    if (!existingUser) {
      // Create new teacher user if doesn't exist
      const uid = `u-${uuidv4()}`;
      await dataManager.createUser({ 
        id: uid, 
        role: 'Teacher', 
        name: name || email.split('@')[0], 
        email, 
        status: 'Active' 
      });
      existingUser = await dataManager.getUserByEmail(email);
      console.log(`[login] Created new teacher ${email} with id ${uid}`);
    } else {
      if ((existingUser.status || '').toLowerCase() !== 'active') {
        await dataManager.updateUserStatus(existingUser.id, 'Active');
        existingUser = await dataManager.getUserByEmail(email);
      }
      console.log(`[login] Found existing teacher ${email} with id ${existingUser.id}`);
    }
    
    const teacherId = existingUser?.id;
    const teacherName = existingUser?.name || name || 'Teacher';
    res.json({ ok: true, teacherId, email, name: teacherName, timestamp: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/__routes', (req, res) => {
  try {
    const routes = app._router.stack
      .filter((r) => r.route && r.route.path)
      .map((r) => ({ path: r.route.path, methods: Object.keys(r.route.methods) }));
    res.json({ ok: true, routes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ ok: false, error: 'Prompt is required' });
    }

    const temperature = Number(req.body.temperature ?? 0.3);
    const maxTokens = Number(req.body.maxTokens ?? 512);

    // DEBUG: Log full prompt the backend received
    console.log(`\n[/api/chat] Received prompt (length=${prompt.length}):`);
    console.log(prompt);
    console.log(`[/api/chat] Temperature: ${temperature}, MaxTokens: ${maxTokens}`);

    const isQuestionRequest = Number(req.body.questionNumber) > 0 || /final_output_only|write one diagnostic question|question only/i.test(prompt);
    let result = null;

    if (isQuestionRequest) {
      const rawQuestion = await modelManager.generateLocalRawResponse({
        prompt,
        temperature,
        maxTokens: Math.max(maxTokens, 1200),
        thinkingEnabled: false
      });
      const rawQuestionText = String(rawQuestion?.message?.content || rawQuestion?.message?.thinking || rawQuestion?.response || '').trim();
      result = {
        source: 'local',
        model: modelManager.ollamaModel,
        text: rawQuestionText,
        fallbackUsed: false,
        raw_response: rawQuestion
      };
    } else {
      result = await modelManager.generate({ prompt, temperature, maxTokens });
    }

    // DEBUG: Log full model response
    console.log(`[/api/chat] Model returned (source=${result.source}):`);
    console.log(result.text);

    // Only treat the response as a hard failure when it is clearly not a usable question.
    // This avoids over-triggering fallback for valid but stylistically plain questions.
    const looksLikeHardFailure = typeof result.text === 'string' && (() => {
      const text = result.text.trim();
      if (!text) return true;
      const lower = text.toLowerCase();
      const analysisMarkers = [
        'analyze the request',
        'analyze the',
        'role:',
        'task:',
        'constraint:',
        'final output generation',
        'proceeding to output',
        'final review against constraints'
      ];
      if (/^\s*1\.\s*\*\*analyze/i.test(text)) return true;
      if (/^\s*(analysis|thinking|reasoning)[:\-]/i.test(text)) return true;
      if (analysisMarkers.some((marker) => lower.includes(marker))) return true;
      // If the model produced a sentence ending in a question mark, treat it as usable.
      if (text.includes('?')) return false;
      // Otherwise only flag very short replies as failures.
      return text.length < 24;
    })();

    if (looksLikeHardFailure) {
      console.log('[/api/chat] Detected analysis-only response; attempting extraction rewrite');
      const extractPrompt = `Extract a single specific diagnostic question from the following assistant reply. Output ONLY the question sentence and nothing else. If no question is present, write a single specific question about the topic described in the original prompt below.\n\nORIGINAL_PROMPT:\n${prompt}\n\nASSISTANT_REPLY:\n${result.text}`;
      try {
        const rawExtract = await modelManager.generateLocalRawResponse({ prompt: extractPrompt, temperature: Math.max(0.05, temperature - 0.05), maxTokens: 300, thinkingEnabled: false });
        const rawExtractText = String(rawExtract?.message?.content || rawExtract?.message?.thinking || rawExtract?.response || '').trim();
        const cleanedExtract = modelManager._cleanResponse(rawExtractText);
        console.log('[/api/chat] Extraction raw result:');
        console.log(rawExtract);
        console.log('[/api/chat] Extraction cleaned:');
        console.log(cleanedExtract);
        if (cleanedExtract && cleanedExtract.includes('?')) {
          result.text = cleanedExtract;
          result.source = 'local';
          result.fallbackUsed = false;
          console.log('[/api/chat] Replaced model output with extracted question.');
        } else {
            console.log('[/api/chat] Extraction did not yield a question; synthesizing deterministic fallback question.');
            // deterministic synthetic question generation from prompt
            try {
              const topicMatch = prompt.match(/about\s+"([^"]+)"|topic:\s*"([^"]+)"|topic:\s*([^\n\"]+)/i);
              const topic = (topicMatch && (topicMatch[1] || topicMatch[2] || topicMatch[3])) ? (topicMatch[1] || topicMatch[2] || topicMatch[3]).trim() : (prompt.split('\n')[0] || 'the topic');
              const topicShort = topic.replace(/\s+/g, ' ').replace(/\.$/, '').trim();
              const topicLower = topicShort.toLowerCase();
              let templates = [];

              if (topicLower.includes('biology')) {
                templates = [
                  `How do photosynthesis and cellular respiration depend on each other in living systems studied in ${topicShort}?`,
                  `What would happen to an ecosystem food web in ${topicShort} if one producer population sharply declined, and why?`,
                  `How does cell specialization allow multicellular organisms in ${topicShort} to maintain homeostasis?`,
                  `In ${topicShort}, how does a change in DNA sequence lead to a visible trait change in an organism?`,
                  `How does natural selection change trait frequency in a population over generations in ${topicShort}?`,
                  `Why does membrane transport balance diffusion and active transport to keep cells stable in ${topicShort}?`,
                  `How does a disruption in one organ system affect another system when maintaining homeostasis in ${topicShort}?`
                ];
              } else if (topicLower.includes('physical education')) {
                templates = [
                  `How does progressive overload improve muscular endurance and reduce injury risk in ${topicShort}?`,
                  `Why does heart rate recovery after interval training indicate cardiovascular fitness in ${topicShort}?`,
                  `How do warm-up and cool-down routines affect performance and injury prevention in ${topicShort}?`,
                  `In ${topicShort}, how does movement mechanics influence efficiency during sprinting or jumping tasks?`,
                  `How does hydration status affect reaction time and endurance during activity in ${topicShort}?`,
                  `Why do teamwork communication strategies improve tactical decisions in ${topicShort}?`,
                  `How can training intensity and rest intervals be adjusted to target aerobic versus anaerobic performance in ${topicShort}?`
                ];
              } else if (topicLower.includes('music')) {
                templates = [
                  `How does rhythm shape the mood or meaning of a piece of music studied in ${topicShort}?`,
                  `Why would changing tempo or dynamics alter the way a listener experiences ${topicShort}?`,
                  `How do melody and harmony work together in ${topicShort} to create a musical effect?`,
                  `What happens to a performance in ${topicShort} if one instrument or voice part drops out, and why?`,
                  `How can repeated practice improve accuracy and expression in ${topicShort}?`,
                  `Why is musical structure important when analyzing a piece in ${topicShort}?`,
                  `How would you describe the difference between a steady beat and a changing rhythm in ${topicShort}?`
                ];
              } else {
                templates = [
                  `What is one important idea about ${topicShort}, and how does it work?`,
                  `How would you explain ${topicShort} to a classmate using one concrete example?`,
                  `Why does ${topicShort} matter in this class?`,
                  `Can you give one example that shows ${topicShort} in action?`,
                  `What might happen if ${topicShort} is misunderstood?`,
                  `How can a student apply a principle from ${topicShort} to solve a concrete problem?`,
                  `How do two related ideas in ${topicShort} interact to produce an outcome?`
                ];
              }
              // Vary template based on questionNumber; if not provided, use index 0
              const questionNumber = Number(req.body.questionNumber) || 1;
              const templateIndex = (questionNumber - 1) % templates.length;
              const synthetic = templates[templateIndex];
              result.text = synthetic;
              result.source = 'synthetic-fallback';
              result.fallbackUsed = true;
              console.log(`[/api/chat] Synthesized question (template ${templateIndex}, Q${questionNumber}):`, result.text);
              // Write debug info to a log so we can inspect prompts/responses that triggered synthetic fallback
              try {
                const fs = require('fs');
                const path = require('path');
                const debugEntry = {
                  timestamp: new Date().toISOString(),
                  reason: 'synthetic-fallback',
                  requestBody: Object.assign({}, req.body || {}),
                  promptPreview: (prompt || '').slice(0, 200),
                  syntheticTemplateIndex: templateIndex,
                  syntheticText: result.text,
                  modelSource: result.source || null,
                };
                const logPath = path.join(__dirname, '..', 'question_debug.log');
                try {
                  // Ensure the backend folder exists (it should), then append
                  fs.appendFileSync(logPath, JSON.stringify(debugEntry) + '\n');
                } catch (innerErr) {
                  // As a last resort, write to cwd path
                  try {
                    fs.appendFileSync('question_debug.log', JSON.stringify(debugEntry) + '\n');
                  } catch (finalErr) {
                    console.warn('[/api/chat] Failed to write debug log to fallback paths:', finalErr.message || finalErr);
                  }
                }
              } catch (logErr) {
                console.warn('[/api/chat] Failed to prepare debug log:', logErr.message || logErr);
              }
            } catch (synthErr) {
              console.error('[/api/chat] Synthetic fallback failed:', synthErr);
            }
        }
      } catch (extractionErr) {
        console.error('[/api/chat] Extraction attempt failed:', extractionErr.message || extractionErr);
      }
    }
    
    let fullResponse = null;

    // When SUMMARY_BY_DEFAULT is true, also fetch raw and summary for the side-by-side view
    if (modelManager.summaryByDefault) {
      const local = await modelManager.checkLocal();
      if (local.available) {
        const raw = await modelManager.generateLocalRaw({ prompt, temperature, maxTokens });
        const summaryPrompt = `Please produce a concise 2-3 sentence summary of the following answer, suitable for a teacher in a rural classroom:\n\n${raw}`;
        const summaryRaw = await modelManager.generateLocalRaw({ prompt: summaryPrompt, temperature: Math.max(0.1, temperature - 0.1), maxTokens: 180 });
        const summary = modelManager._cleanResponse(summaryRaw);
        
        fullResponse = {
          summary,
          cleaned: result.text,
          raw
        };
      }
    }

    // Attempt to coerce model output into a strict JSON shape: {"question":"..."}
    // If the model returned analysis text, ask it to convert to JSON and retry parsing.
    try {
      const tryParseQuestionFromText = (txt) => {
        if (!txt || typeof txt !== 'string') return null;
        // Try direct JSON parse
        try {
          const j = JSON.parse(txt);
          if (j && typeof j.question === 'string') return j.question.trim();
        } catch (e) {
          // not raw json, try to extract with regex
          const m = txt.match(/\{\s*"question"\s*:\s*"([^"]+)"\s*\}/i);
          if (m && m[1]) return m[1].trim();
        }
        // Try heuristic: look for first sentence that ends with a question mark
        const qm = txt.match(/([\s\S]*?\?)\s*$/);
        if (qm && qm[1]) return qm[1].trim();
        // fallback null
        return null;
      };

      let parsedQuestion = tryParseQuestionFromText(result.text || '');
      if (!parsedQuestion) {
        // Ask the model to convert its prior reply into JSON question form
        const conversionPrompt = `Convert the following assistant reply into a JSON object with exactly one property named \"question\" whose value is a single question sentence. Reply with only the JSON object and nothing else.\n\nASSISTANT_REPLY:\n${result.text || ''}`;
        const conversion = await modelManager.generateLocal({ prompt: conversionPrompt, temperature: 0.0, maxTokens: 200, thinkingEnabled: false });
        parsedQuestion = tryParseQuestionFromText(conversion || '');
        // If conversion produced a question, use it and mark source
        if (parsedQuestion) {
          result.text = parsedQuestion;
          result.source = result.source || 'local';
          result.parsedFrom = 'conversion-rewrite';
        }
      } else {
        // If we parsed successfully from original text, normalize
        result.text = parsedQuestion;
        result.parsedFrom = result.parsedFrom || 'direct-parse';
      }
    } catch (coerceErr) {
      console.warn('[/api/chat] Coercion to JSON failed:', coerceErr.message || coerceErr);
    }

    res.json({
      ok: true,
      ...result,
      config: modelManager.getConfig(),
      full_response: fullResponse
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to generate response'
    });
  }
});

// Return raw (untrimmed) model output for UI 'Show more' requests
app.post('/api/chat/raw', async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ ok: false, error: 'Prompt is required' });

    const temperature = Number(req.body.temperature ?? 0.3);
    const maxTokens = Number(req.body.maxTokens ?? 1024);

    const local = await modelManager.checkLocal();
    if (local.available) {
      const raw = await modelManager.generateLocalRaw({ prompt, temperature, maxTokens });
      return res.json({ ok: true, text: raw, source: 'local', model: modelManager.ollamaModel });
    }

    if (!modelManager.offlineOnly && modelManager.cloudEnabled) {
      const raw = await modelManager.generateCloud({ prompt, temperature, maxTokens });
      return res.json({ ok: true, text: raw, source: 'cloud', model: modelManager.cloudModel });
    }

    return res.status(503).json({ ok: false, error: 'Local model unavailable and cloud fallback disabled' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Failed to fetch raw response' });
  }
});

// Analytics endpoint: track "Show more" and other user interactions
app.post('/api/analytics', (req, res) => {
  const { event, timestamp, details } = req.body;
  console.log(`[ANALYTICS] ${event} at ${timestamp}:`, details);
  res.json({ ok: true, recorded: true });
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await dataManager.listUsers();
    res.json({ ok: true, users });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    const { role, name, email, status } = req.body || {};
    const trimmedName = String(name || '').trim();
    const trimmedEmail = String(email || '').trim();
    if (!trimmedName || !trimmedEmail) {
      return res.status(400).json({ ok: false, error: 'name and email are required' });
    }

    const user = await dataManager.createUser({
      id: `u-${uuidv4()}`,
      role: role === 'Teacher' ? 'Teacher' : 'Student',
      name: trimmedName,
      email: trimmedEmail,
      status: status || 'Invited'
    });

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/admin/users/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    const nextStatus = String(status || '').trim();
    if (!nextStatus) {
      return res.status(400).json({ ok: false, error: 'status is required' });
    }

    const updated = await dataManager.updateUserStatus(req.params.id, nextStatus);
    if (!updated.changes) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const user = await dataManager.getUserById(req.params.id);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const result = await dataManager.deleteUser(req.params.id);
    if (!result.changes) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    res.json({ ok: true, deleted: result.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Test endpoint
app.get('/api/test-upload', (req, res) => {
  res.json({ ok: true, message: 'Upload endpoint is reachable' });
});

// Teacher: upload curriculum (file + metadata)
app.post('/api/teacher/upload', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'curriculum', maxCount: 1 }]), async (req, res) => {
  try {
    console.log('[UPLOAD] Received request. Files:', Object.keys(req.files || {}), 'Body keys:', Object.keys(req.body || {}));
    const file = getUploadedFile(req);
    console.log('[UPLOAD] File:', file ? `${file.filename} (${file.size} bytes)` : 'NO FILE');
    const metadata = parseMetadata(req.body.metadata);
    const teacherId = req.body.teacherId || req.headers['x-teacher-id'];
    const classname = req.body.classname || 'Untitled Class';
    
    // Store teacher info in metadata
    metadata.teacherId = teacherId;
    metadata.classname = classname;
    metadata.uploadedAt = new Date().toISOString();
    if (!file) return res.status(400).json({ ok: false, error: 'File required' });
    const id = `c-${uuidv4()}`;
    // attempt PDF rasterization and text extraction for PDFs
    let pages = null;
    let extractionPrompt = null;
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      const curriculumDir = path.join(UPLOAD_DIR, id);
      const pdfToolAvailable = isCommandAvailable('pdftoppm');
      if (pdfToolAvailable) {
        try {
          pages = await rasterizePdf(path.join(UPLOAD_DIR, file.filename), curriculumDir);
          metadata.pages = pages.map((p) => path.relative(path.join(__dirname, '..'), p));
        } catch (err) {
          console.warn('PDF rasterization skipped after tool check:', err.message);
          metadata.rasterization = { status: 'skipped', reason: err.message };
        }
      } else {
        console.log('PDF rasterization skipped: pdftoppm not installed; using pdf-parse fallback');
        metadata.rasterization = {
          status: 'skipped',
          reason: 'pdftoppm not installed; text extraction fallback used'
        };
      }

      // Always extract text through a best-effort pipeline. On Windows we fall back to pdf-parse.
      try {
        const { text, pageCount } = await analyzePdf(path.join(UPLOAD_DIR, file.filename));
        if (pageCount) {
          metadata.pageCount = pageCount;
          if (!pages || !pages.length) {
            pages = Array.from({ length: pageCount }, (_, index) => `page-${index + 1}`);
          }
        }
        if (text && text.length > 100) {
          extractionPrompt = `You are a JSON extraction assistant. Your response MUST be ONLY valid JSON, no other text.

Extract from this text and return ONLY this JSON structure:
{
  "title": "extracted title",
  "objectives": ["objective 1", "objective 2", "objective 3"],
  "vocabulary": ["term1", "term2", "term3", "term4", "term5"],
  "outline": [{"section": "section name", "bullets": ["point 1", "point 2"]}]
}

TEXT TO EXTRACT FROM:
${text.substring(0, 3000)}`;
          // Synchronous extraction during upload (like images) to ensure vocabulary/outline ready immediately
          try {
            console.log(`→ Extracting during upload for ${id}`);
            const extracted = await modelManager.generateLocalRawWithRetry({
              prompt: extractionPrompt,
              temperature: 0.0,
              maxTokens: 1200,
              attempts: 4,
              initialDelay: 3000
            });
            metadata.extracted = extracted;
            console.log(`→ Extraction complete during upload for ${id}`);
          } catch (extractErr) {
            console.warn(`→ Extraction failed during upload for ${id}:`, extractErr.message);
            metadata.extractionError = extractErr.message;
          }
          // If text extraction produced empty or uninformative result, but we rasterized pages,
          // try an image-based extraction pass using the model's multimodal endpoint.
          if ((!metadata.extracted || (typeof metadata.extracted === 'string' && metadata.extracted.trim().length < 80)) && pages && pages.length) {
            try {
              console.log(`→ Attempting image-based extraction for ${id} (scanned PDF)`);
              // Try up to first 3 pages to limit cost
              const tries = Math.min(3, pages.length);
              let imageExtracted = null;
              for (let i = 0; i < tries; i++) {
                const imgPath = path.join(__dirname, '..', pages[i]);
                if (!fs.existsSync(imgPath)) continue;
                const b = fs.readFileSync(imgPath);
                const base64 = b.toString('base64');
                const prompt = `Extract key title, objectives, vocabulary, and an outline from the image of a curriculum page. Reply ONLY with valid JSON matching the schema: { \"title\": string, \"objectives\": [string], \"vocabulary\": [string], \"outline\": [{\"section\": string, \"bullets\": [string]}] }`;
                const candidate = await modelManager.generateLocalWithImage({ imageBase64: base64, imageMime: 'image/png', prompt, temperature: 0.05, maxTokens: 1200 });
                if (candidate && String(candidate).trim().length > 80) {
                  imageExtracted = candidate;
                  break;
                }
              }
              if (imageExtracted) {
                metadata.extracted = imageExtracted;
                metadata.extractionStatus = 'complete';
                console.log(`→ Image-based extraction succeeded for ${id}`);
              }
            } catch (imgErr) {
              console.warn(`→ Image-based extraction failed for ${id}:`, imgErr.message || imgErr);
            }
          }
        } else if (text) {
          metadata.extractedText = text;
        }
      } catch (err) {
        console.warn('PDF analysis failed:', err.message);
        metadata.processingWarning = err.message;
      }
    }

    // If image, send to model as multimodal input to extract concepts
    if ((file.mimetype || '').startsWith('image/') || ['.png', '.jpg', '.jpeg'].some((e) => file.originalname.toLowerCase().endsWith(e))) {
      try {
        const imgPath = path.join(UPLOAD_DIR, file.filename);
        const b = fs.readFileSync(imgPath);
        const base64 = b.toString('base64');
        const prompt = `Extract key concepts, vocabulary, and learning objectives from the following image content. Reply as JSON with keys: title, objectives (array), vocabulary (array), outline (array).`;
        const extracted = await modelManager.generateLocalWithImage({ imageBase64: base64, imageMime: file.mimetype || 'image/png', prompt, temperature: 0.1, maxTokens: 400 });
        metadata.extracted = extracted;
      } catch (err) {
        console.warn('Image extraction failed:', err.message);
        metadata.extractionError = err.message;
      }
    }

    const savedCurriculum = await dataManager.saveCurriculum({ id, filename: file.filename, metadata, teacherId, classname });
    console.log(`✓ Upload complete: ${id} | extracted=${!!metadata.extracted} | text=${!!metadata.extractedText}`);
    // Auto-assign this uploaded curriculum to existing enrollments for the same class
    try {
      // By default auto-assign to the class so weekly lesson plans replace prior curriculum for enrolled students
      const autoAssign = req.body.autoAssign !== 'false';
      if (autoAssign && teacherId && classname) {
        const assignResult = await dataManager.assignCurriculumToClass(id, teacherId, classname);
        console.log(`→ Auto-assigned curriculum ${id} to class ${classname} (teacher ${teacherId}):`, assignResult);
      }
    } catch (assignErr) {
      console.warn('Auto-assign failed:', assignErr.message || assignErr);
    }
    res.json({
      ok: true,
      curriculumId: id,
      curriculum: savedCurriculum,
      filename: file.filename,
      pages: pages ? pages.length : 0,
      metadata
    });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// List all curricula for a teacher
app.get('/api/teacher/curricula', async (req, res) => {
  try {
    const teacherId = req.query.teacherId;
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    const curricula = await dataManager.listCurriculaByTeacher(teacherId);
    res.json({ ok: true, curricula, count: curricula.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Dashboard metrics for teacher (aggregated from DB)
app.get('/api/teacher/dashboard-metrics', async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });

    // List curricula for teacher
    const curricula = await dataManager.listCurriculaByTeacher(teacherId);
    const curriculumIds = (curricula || []).map((c) => c.id).filter(Boolean);
    const roster = await dataManager.listEnrollmentsByTeacher(teacherId);
    const identityLookup = buildStudentIdentityLookup(roster);
    const studentDirectoryRows = await new Promise((resolve) => {
      dataManager.db.all(`SELECT id, name FROM students`, [], (err, rows) => {
        if (err) return resolve([]);
        resolve(rows || []);
      });
    });
    const studentDirectory = new Map(
      studentDirectoryRows.map((row) => [normalizeToken(row.id), String(row.name || row.id || '').trim()])
    );

    // totalStudents (distinct enrollments for this teacher)
    const totalStudents = await new Promise((resolve) => {
      dataManager.db.get(`SELECT COUNT(DISTINCT studentKey) as cnt FROM enrollments WHERE teacherId = ?`, [teacherId], (err, row) => {
        if (err) return resolve(0);
        resolve(row?.cnt || 0);
      });
    });

    let startedStudents = 0;
    let completedStudents = 0;
    let startedSessions = 0;
    let completedSessions = 0;
    let averageHints = null;
    let medianActiveTime = null;
    let medianElapsedTime = null;

    const formatDuration = (ms) => {
      const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
      }
      return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    };

    const medianFrom = (values) => {
      const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
      if (!sorted.length) return null;
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };

    const calculateActiveDuration = (sessionRow, timestamps = []) => {
      const gapLimitMs = 5 * 60 * 1000;
      const points = [sessionRow.startTime, ...timestamps, sessionRow.endTime]
        .map((value) => Number(value || 0))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
      if (points.length < 2) return 0;
      let activeMs = 0;
      for (let index = 1; index < points.length; index++) {
        const gap = points[index] - points[index - 1];
        if (gap > 0 && gap <= gapLimitMs) {
          activeMs += gap;
        }
      }
      return activeMs;
    };

    if (curriculumIds.length) {
      const curriculumPlaceholders = curriculumIds.map(() => '?').join(',');
      const sessionRows = await new Promise((resolve) => {
        dataManager.db.all(
          `SELECT s.id, s.startTime, s.endTime, p.studentId, COUNT(p.id) AS attempts, SUM(CASE WHEN p.hintRequested = 1 THEN 1 ELSE 0 END) AS hintsUsed
           FROM sessions s
           LEFT JOIN progress p ON p.sessionId = s.id
           WHERE s.curriculumId IN (${curriculumPlaceholders})
           GROUP BY s.id, s.startTime, s.endTime, p.studentId
           ORDER BY COALESCE(s.endTime, s.startTime, s.created_at) DESC`,
          curriculumIds,
          (err, rows) => {
            if (err) return resolve([]);
            resolve(rows || []);
          }
        );
      });

      const sessionIds = sessionRows.map((row) => row.id).filter(Boolean);
      const progressRows = sessionIds.length ? await new Promise((resolve) => {
        const placeholders = sessionIds.map(() => '?').join(',');
        dataManager.db.all(
          `SELECT sessionId, timestamp
           FROM progress
           WHERE sessionId IN (${placeholders})
           ORDER BY sessionId, timestamp ASC`,
          sessionIds,
          (err, rows) => {
            if (err) return resolve([]);
            resolve(rows || []);
          }
        );
      }) : [];

      const progressTimestampsBySession = new Map();
      for (const row of progressRows) {
        if (!progressTimestampsBySession.has(row.sessionId)) {
          progressTimestampsBySession.set(row.sessionId, []);
        }
        progressTimestampsBySession.get(row.sessionId).push(Number(row.timestamp || 0));
      }

      const startedStudentIds = new Set();
      const completedStudentIds = new Set();
      const startedRows = [];
      const completedRows = [];
      const startedActiveDurations = [];
      const completedElapsedDurations = [];
      for (const row of sessionRows) {
        const studentKey = String(row.studentId || '').trim();
        const started = Number(row.attempts || 0) > 0 || Number(row.startTime || 0) > 0;
        const completed = Number(row.endTime || 0) > 0;
        if (started) {
          startedRows.push(row);
          startedActiveDurations.push(calculateActiveDuration(row, progressTimestampsBySession.get(row.id) || []));
          if (studentKey) startedStudentIds.add(studentKey.toLowerCase());
          startedSessions += 1;
        }
        if (completed) {
          completedRows.push(row);
          completedElapsedDurations.push(Number(row.endTime || 0) - Number(row.startTime || 0));
          if (studentKey) completedStudentIds.add(studentKey.toLowerCase());
          completedSessions += 1;
        }
      }

      startedStudents = startedStudentIds.size;
      completedStudents = completedStudentIds.size;
      averageHints = startedRows.length
        ? Number((startedRows.reduce((sum, row) => sum + Number(row.hintsUsed || 0), 0) / startedRows.length).toFixed(1))
        : null;

      // Exclude zero-length active durations (sessions with no recorded progress)
      const nonZeroActiveDurations = (startedActiveDurations || []).filter((v) => Number.isFinite(v) && v > 0);
      const medianActiveMs = medianFrom(nonZeroActiveDurations);
      const medianElapsedMs = medianFrom(completedElapsedDurations);
      medianActiveTime = medianActiveMs == null ? null : formatDuration(medianActiveMs);
      medianElapsedTime = medianElapsedMs == null ? null : formatDuration(medianElapsedMs);
    }

    // sessionsToday (by startTime >= midnight local)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let sessionsToday = 0;
    if (curriculumIds.length) {
      const placeholders = curriculumIds.map(() => '?').join(',');
      const params = [...curriculumIds, startOfDay.getTime()];
      sessionsToday = await new Promise((resolve) => {
        dataManager.db.get(
          `SELECT COUNT(*) as cnt FROM sessions WHERE curriculumId IN (${placeholders}) AND startTime >= ?`,
          params,
          (err, row) => {
            if (err) return resolve(0);
            resolve(row?.cnt || 0);
          }
        );
      });
    }

    // Average score and students needing attention (correct rate < 0.5)
    let averageScore = null;
    let studentsNeedingAttention = 0;
    if (curriculumIds.length) {
      const placeholders = curriculumIds.map(() => '?').join(',');
      // Aggregate progress joined to sessions for the teacher's curricula
      const rows = await new Promise((resolve) => {
        dataManager.db.all(
          `SELECT p.studentId, SUM(p.correct) as correctSum, COUNT(*) as attempts FROM progress p JOIN sessions s ON p.sessionId = s.id WHERE s.curriculumId IN (${placeholders}) GROUP BY p.studentId`,
          curriculumIds,
          (err, r) => {
            if (err) return resolve([]);
            resolve(r || []);
          }
        );
      });

      if (rows.length) {
        const mergedRates = new Map();
        for (const row of rows) {
          const identity = resolveStudentIdentity(row.studentId, identityLookup, studentDirectory);
          if (!mergedRates.has(identity.canonicalKey)) {
            mergedRates.set(identity.canonicalKey, { correct: 0, attempts: 0 });
          }
          const current = mergedRates.get(identity.canonicalKey);
          current.correct += Number(row.correctSum || 0);
          current.attempts += Number(row.attempts || 0);
        }

        const rates = Array.from(mergedRates.values());
        const totalCorrect = rates.reduce((s, r) => s + r.correct, 0);
        const totalAttempts = rates.reduce((s, r) => s + r.attempts, 0);
        averageScore = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : null;
        studentsNeedingAttention = rates.filter((r) => (r.attempts ? (r.correct / r.attempts) : 0) < 0.5).length;
      } else {
        averageScore = null;
        studentsNeedingAttention = 0;
      }
    }

    // Week sessions (last 7 days)
    const weekSessions = [];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const nextD = new Date(d);
      nextD.setDate(nextD.getDate() + 1);
      const dayCount = await new Promise((resolve) => {
        if (!curriculumIds.length) return resolve(0);
        const ph = curriculumIds.map(() => '?').join(',');
        dataManager.db.get(
          `SELECT COUNT(*) as cnt FROM sessions WHERE curriculumId IN (${ph}) AND startTime >= ? AND startTime < ?`,
          [...curriculumIds, d.getTime(), nextD.getTime()],
          (err, row) => {
            if (err) return resolve(0);
            resolve(row?.cnt || 0);
          }
        );
      });
      weekSessions.push({ day: days[(d.getDay() + 1) % 7], sessions: dayCount });
    }

    // Heatmap: students x curricula mastery
    const heatmap = [];
    const curriculumLabels = (curricula || []).slice(0, 5).map((curriculum) => curriculum.classname || curriculum.filename || curriculum.id);
    if (curriculumIds.length) {
      const perStudentCurriculum = await new Promise((resolve) => {
        dataManager.db.all(
          `SELECT p.studentId, s.id as sessionId, s.curriculumId, s.endTime, SUM(p.correct) as c, COUNT(*) as t, MAX(p.timestamp) as lastTs
           FROM progress p
           JOIN sessions s ON p.sessionId = s.id
           WHERE s.curriculumId IN (${curriculumIds.map(() => '?').join(',')})
           GROUP BY p.studentId, s.id, s.curriculumId, s.endTime`,
          curriculumIds,
          (err, rows) => {
            if (err) return resolve([]);
            resolve(rows || []);
          }
        );
      });

      const grouped = new Map();
      for (const row of perStudentCurriculum) {
        const identity = resolveStudentIdentity(row.studentId, identityLookup, studentDirectory);
        if (!grouped.has(identity.canonicalKey)) {
          grouped.set(identity.canonicalKey, {
            studentId: identity.canonicalKey,
            student: identity.display,
            perCurriculum: new Map(),
            lastTs: 0,
            completed: false,
            latestSessionEndTime: 0
          });
        }
        const item = grouped.get(identity.canonicalKey);
        const existing = item.perCurriculum.get(row.curriculumId) || { c: 0, t: 0 };
        existing.c += Number(row.c || 0);
        existing.t += Number(row.t || 0);
        item.perCurriculum.set(row.curriculumId, existing);
        item.lastTs = Math.max(item.lastTs, Number(row.lastTs || 0));
        const endTime = Number(row.endTime || 0);
        if (endTime > 0) {
          item.completed = true;
          item.latestSessionEndTime = Math.max(item.latestSessionEndTime, endTime);
        }
      }

      const topStudents = Array.from(grouped.values())
        .sort((a, b) => b.lastTs - a.lastTs)
        .slice(0, 5);

      for (const item of topStudents) {
        const row = {
          studentId: item.studentId,
          student: item.student,
          completed: item.completed,
          latestSessionEndTime: item.latestSessionEndTime,
          topics: []
        };
        for (const currId of curriculumIds.slice(0, 5)) {
          const scoreParts = item.perCurriculum.get(currId);
          const score = scoreParts?.t ? Math.round((scoreParts.c / scoreParts.t) * 100) : 0;
          row.topics.push(score);
        }
        heatmap.push(row);
      }
    }

    // Map to frontend-friendly fields
    const metrics = {
      totalStudents: totalStudents || 0,
      enrolledStudents: totalStudents || 0,
      startedStudents,
      completedStudents,
      startedSessions,
      completedSessions,
      completionRate: totalStudents ? Math.round((completedStudents / totalStudents) * 100) : null,
      sessionCompletionRate: startedSessions ? Math.round((completedSessions / startedSessions) * 100) : null,
      participationRate: totalStudents ? Math.round((startedStudents / totalStudents) * 100) : null,
      averageHints,
      medianActiveTime,
      medianElapsedTime,
      activeSessions: sessionsToday || 0,
      avgScore: averageScore || 0,
      totalUploaded: curricula.length || 0,
      studentsNeedingAttention: studentsNeedingAttention || 0,
      weekSessions,
      heatmap,
      curriculumLabels
    };

    return res.json({ ok: true, metrics });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get curriculum metadata
app.get('/api/teacher/curriculum/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const c = await dataManager.getCurriculum(id);
    if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
    // If extracted metadata exists but looks generic/placeholder, attempt a synchronous re-extraction
    try {
      const meta = c.metadata || {};
      const extractedRaw = typeof meta.extracted === 'string' ? meta.extracted.trim() : '';
      const looksTooShort = extractedRaw && extractedRaw.length < 120;
      const looksGeneric = extractedRaw && /\b(start with|main idea|key idea|important concept|think about how|consider how)\b/i.test(extractedRaw);

      if ((!extractedRaw || looksTooShort || looksGeneric) && (meta.extractedText || c.filename)) {
        // Prepare source text for extraction: prefer extractedText, else re-read PDF
        let textToExtract = meta.extractedText || null;
        if (!textToExtract && c.filename) {
          try {
            const uploadedFilePath = path.join(UPLOAD_DIR, c.filename);
            if (fs.existsSync(uploadedFilePath)) {
              const analyzed = await analyzePdf(uploadedFilePath);
              textToExtract = analyzed.text;
            }
          } catch (readErr) {
            console.warn(`[CURR] Could not re-read PDF for ${id}:`, readErr.message);
          }
        }

        if (textToExtract && textToExtract.length > 100) {
          const extractionPrompt = `You are a JSON extraction assistant. Your response MUST be ONLY valid JSON, no other text.\n\nExtract from this text and return ONLY this JSON structure:\n{\n  "title": "extracted title",\n  "objectives": ["objective 1", "objective 2", "objective 3"],\n  "vocabulary": ["term1", "term2", "term3", "term4", "term5"],\n  "outline": [{"section": "section name", "bullets": ["point 1", "point 2"]}]\n}\n\nTEXT TO EXTRACT FROM:\n${String(textToExtract).substring(0, 3000)}`;
          try {
            const newExtract = await modelManager.generateLocalRawWithRetry({ prompt: extractionPrompt, temperature: 0.0, maxTokens: 1200, attempts: 4, initialDelay: 2000 });
            meta.extracted = newExtract;
            meta.extractionStatus = 'complete';
            await dataManager.updateCurriculum(id, meta);
            // refresh curriculum object
            const refreshed = await dataManager.getCurriculum(id);
            return res.json({ ok: true, curriculum: refreshed });
          } catch (bgErr) {
            console.warn(`[CURR] Re-extraction failed for ${id}:`, bgErr.message || bgErr);
            // If re-extraction from text failed or was uninformative, and there are rasterized pages, try image-based extraction
            try {
              if (meta.pages && meta.pages.length) {
                console.log(`[CURR] Trying image-based re-extraction for ${id}`);
                const tries = Math.min(3, meta.pages.length);
                let imageExtracted = null;
                for (let i = 0; i < tries; i++) {
                  const pth = path.join(UPLOAD_DIR, meta.pages[i]);
                  if (!fs.existsSync(pth)) continue;
                  const b = fs.readFileSync(pth);
                  const base64 = b.toString('base64');
                  const prompt = `Extract key title, objectives, vocabulary, and an outline from the image of a curriculum page. Reply ONLY with valid JSON matching the schema: { \"title\": string, \"objectives\": [string], \"vocabulary\": [string], \"outline\": [{\"section\": string, \"bullets\": [string]}] }`;
                  const candidate = await modelManager.generateLocalWithImage({ imageBase64: base64, imageMime: 'image/png', prompt, temperature: 0.05, maxTokens: 1200 });
                  if (candidate && String(candidate).trim().length > 80) {
                    imageExtracted = candidate;
                    break;
                  }
                }
                if (imageExtracted) {
                  meta.extracted = imageExtracted;
                  meta.extractionStatus = 'complete';
                  await dataManager.updateCurriculum(id, meta);
                  const refreshed2 = await dataManager.getCurriculum(id);
                  return res.json({ ok: true, curriculum: refreshed2 });
                }
              }
            } catch (imgErr) {
              console.warn(`[CURR] Image re-extraction failed for ${id}:`, imgErr.message || imgErr);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[CURR] Extraction check failed:', e.message || e);
    }

    res.json({ ok: true, curriculum: c });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Update curriculum metadata (teacher review/edit)
app.post('/api/teacher/curriculum/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const metadata = req.body.metadata || {};
    await dataManager.updateCurriculum(id, metadata);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Delete curriculum (teacher)
app.delete('/api/teacher/curriculum/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const curriculum = await dataManager.getCurriculum(id);
    if (!curriculum) return res.status(404).json({ ok: false, error: 'Curriculum not found' });

    // Attempt to remove uploaded file and any rasterized pages
    try {
      if (curriculum.filename) {
        const filePath = path.join(UPLOAD_DIR, curriculum.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        // remove pages directory if exists (uploads/<id> folder)
        const pagesDir = path.join(UPLOAD_DIR, id);
        if (fs.existsSync(pagesDir)) {
          const files = fs.readdirSync(pagesDir);
          for (const f of files) {
            try { fs.unlinkSync(path.join(pagesDir, f)); } catch (e) {}
          }
          try { fs.rmdirSync(pagesDir); } catch (e) {}
        }
      }
    } catch (fsErr) {
      console.warn('[DELETE CURR] File cleanup failed:', fsErr.message || fsErr);
    }

    await dataManager.deleteCurriculum(id);
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Generate opening question for a session (adaptive engine scaffold)
app.post('/api/session/opening', async (req, res) => {
  try {
    const { sessionId, grade, subject } = req.body;
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
    const session = await dataManager.getSessionById(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const prompt = `Generate an opening diagnostic question for grade ${grade || 'unknown'} in subject ${subject || 'general'} aimed at assessing prior knowledge. Provide a single clear question.`;
    const question = await modelManager.generateLocal({ prompt, temperature: 0.2, maxTokens: 120 });
    // store opening question in session metadata
    const meta = session.metadata || {};
    meta.opening = { question, grade, subject, generatedAt: Date.now() };
    await dataManager.updateSessionMetadata(session.id, meta);
    res.json({ ok: true, question });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// Create session
app.post('/api/session/create', async (req, res) => {
  try {
    const { title, curriculumId, startTime, endTime } = req.body;
    const id = `s-${uuidv4()}`;
    const joinCode = Math.random().toString(36).slice(2, 6).toUpperCase();
    const session = await dataManager.createSession({ id, title, curriculumId, joinCode, startTime, endTime });
    res.json({ ok: true, session });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


// Persist generated question text so transcripts can replay the exact prompt later.
app.post('/api/session/question', async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const studentId = String(req.body?.studentId || '').trim();
    const questionId = String(req.body?.questionId || '').trim();
    const text = String(req.body?.text || '').trim();
    const difficulty = Number(req.body?.difficulty ?? 2);

    if (!sessionId || !studentId || !questionId || !text) {
      return res.status(400).json({ ok: false, error: 'sessionId, studentId, questionId, and text are required' });
    }

    const canonicalStudentId = await resolveCanonicalProgressStudentId(sessionId, studentId);
    const id = `qrec-${sessionId}-${questionId}`;
    await dataManager.createQuestion({ id, sessionId, studentId: canonicalStudentId, questionId, text, difficulty });
    res.json({ ok: true, question: { id, sessionId, studentId: canonicalStudentId, questionId, text, difficulty } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});
// Join session
app.post('/api/session/join', async (req, res) => {
  try {
    const { joinCode, userName, studentCode } = req.body;
    if (!joinCode || !userName) return res.status(400).json({ ok: false, error: 'joinCode and userName required' });
    const session = await dataManager.findSessionByJoinCode(joinCode);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const studentId = `u-${uuidv4()}`;
    await dataManager.createStudent({ id: studentId, name: userName });
    if (session.curriculumId) {
      const curriculum = await dataManager.getCurriculum(session.curriculumId);
      await dataManager.enrollStudent({
        studentName: userName,
        studentCode,
        curriculumId: session.curriculumId,
        teacherId: curriculum?.teacherId || null,
        classname: curriculum?.classname || curriculum?.metadata?.classname || curriculum?.filename || 'Untitled class'
      });
    }
    res.json({ ok: true, sessionId: session.id, studentId, session });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/student/enrollments', async (req, res) => {
  try {
    const studentName = String(req.query.studentName || '').trim();
    const studentCode = String(req.query.studentCode || '').trim();
    if (!studentName) return res.status(400).json({ ok: false, error: 'studentName required' });
    let enrollments = await dataManager.listEnrollmentsByStudent({ studentName, studentCode });
    let matchedBy = 'name+code';
    if (!enrollments.length && studentCode) {
      enrollments = await dataManager.listEnrollmentsByStudent({ studentName, studentCode: '' });
      matchedBy = enrollments.length ? 'name-only-fallback' : matchedBy;
    }

    const loginCandidates = new Set([
      String(studentName || '').trim(),
      String(studentCode || '').trim(),
      `${String(studentName || '').trim()}|${String(studentCode || '').trim()}`.trim()
    ].map((value) => String(value || '').trim()).filter(Boolean).map((value) => value.toLowerCase()));

    const enrichedEnrollments = await Promise.all((enrollments || []).map(async (enrollment) => {
      const latestCompletedSession = await new Promise((resolve) => {
        dataManager.db.get(
          `SELECT id, endTime FROM sessions WHERE curriculumId = ? AND endTime IS NOT NULL ORDER BY endTime DESC LIMIT 1`,
          [enrollment.curriculumId],
          (err, row) => {
            if (err) return resolve(null);
            resolve(row || null);
          }
        );
      });

      if (!latestCompletedSession?.id) {
        return { ...enrollment, sessionCompleted: false, latestCompletedSessionId: null, latestCompletedSessionEndTime: null };
      }

      const candidateIds = new Set([
        enrollment.studentKey,
        enrollment.studentName,
        enrollment.studentCode,
        `${enrollment.studentName || ''}|${enrollment.studentCode || ''}`,
        ...loginCandidates
      ].map((value) => String(value || '').trim()).filter(Boolean).map((value) => value.toLowerCase()));

      const candidateArr = Array.from(candidateIds);
      let sessionCompleted = false;
      if (candidateArr.length) {
        const placeholders = candidateArr.map(() => '?').join(',');
        sessionCompleted = await new Promise((resolve) => {
          dataManager.db.get(
            `SELECT 1 as exists_flag FROM progress WHERE sessionId = ? AND lower(trim(studentId)) IN (${placeholders}) LIMIT 1`,
            [latestCompletedSession.id, ...candidateArr],
            (err, row) => {
              if (err) return resolve(false);
              resolve(!!row);
            }
          );
        });
      }

      return {
        ...enrollment,
        sessionCompleted,
        latestCompletedSessionId: sessionCompleted ? latestCompletedSession.id : null,
        latestCompletedSessionEndTime: sessionCompleted ? latestCompletedSession.endTime : null
      };
    }));

    res.json({ ok: true, enrollments: enrichedEnrollments, matchedBy });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/student/enroll', async (req, res) => {
  try {
    const { studentName, studentCode, curriculumId, classname } = req.body || {};
    if (!studentName || (!curriculumId && !classname)) {
      return res.status(400).json({ ok: false, error: 'studentName and curriculumId or classname required' });
    }

    let resolvedCurriculumId = curriculumId || null;
    let resolvedClassname = classname || null;
    let teacherId = null;

    if (!resolvedCurriculumId && resolvedClassname) {
      const curriculum = await dataManager.findCurriculumByClassname(resolvedClassname);
      if (curriculum) {
        resolvedCurriculumId = curriculum.id;
        teacherId = curriculum.teacherId || null;
        resolvedClassname = curriculum.classname || curriculum.metadata?.classname || resolvedClassname;
      }
    }

    if (!resolvedCurriculumId) {
      return res.status(404).json({ ok: false, error: 'Curriculum not found' });
    }

    const curriculum = await dataManager.getCurriculum(resolvedCurriculumId);
    const enrollment = await dataManager.enrollStudent({
      studentName,
      studentCode,
      curriculumId: resolvedCurriculumId,
      teacherId: teacherId || curriculum?.teacherId || null,
      classname: resolvedClassname || curriculum?.classname || curriculum?.metadata?.classname || curriculum?.filename || 'Untitled class'
    });

    res.json({ ok: true, enrollment });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Record answer
app.post('/api/session/answer', async (req, res) => {
  try {
    const { sessionId, studentId, questionId, answer, correct, hintRequested } = req.body;
    if (!sessionId || !studentId || !questionId) return res.status(400).json({ ok: false, error: 'Missing fields' });
    const canonicalStudentId = await resolveCanonicalProgressStudentId(sessionId, studentId);
    await dataManager.recordAnswer({ sessionId, studentId: canonicalStudentId, questionId, answer, correct: !!correct, hintRequested: !!hintRequested });
    // After recording, compute possible difficulty adjustment (simple heuristic)
    // If two most recent answers are correct -> increment difficulty for student
    // If two most recent answers are incorrect -> decrement difficulty
    try {
      const last = await dataManager.getLastAnswers(sessionId, canonicalStudentId, 2);
      let adjustment = 0;
      if (last.length >= 2) {
        const bothCorrect = last.every((r) => r.correct);
        const bothWrong = last.every((r) => !r.correct && !r.hintRequested);
        if (bothCorrect) adjustment = 1;
        if (bothWrong) adjustment = -1;
      }
      // store adjustment in session metadata under studentDifficulty map
      const session = await dataManager.getSessionById(sessionId);
      const meta = session.metadata || {};
      meta.difficulties = meta.difficulties || {};
      meta.difficulties[canonicalStudentId] = Math.min(3, Math.max(1, (meta.difficulties[canonicalStudentId] || 2) + adjustment));
      await dataManager.updateSessionMetadata(sessionId, meta);
    } catch (e) {
      console.warn('Difficulty adjust failed:', e.message);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/session/complete', async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
    const completedAt = Number(req.body?.endTime) || Date.now();
    const session = await dataManager.setSessionEndTime(sessionId, completedAt);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    res.json({ ok: true, session });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get next question (adaptive)
app.post('/api/session/next', async (req, res) => {
  try {
    const { sessionId, studentId, studentCode, grade, subject } = req.body;
    if (!sessionId || !studentId) return res.status(400).json({ ok: false, error: 'sessionId and studentId required' });
    const session = await dataManager.getSessionById(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });

    // If frontend provided an explicit studentCode (e.g., BRIDGE-08-01), prefer resolving by that
    let canonicalStudentId = null;
    if (studentCode) {
      const enrollmentByCode = await new Promise((resolve) => {
        dataManager.db.get(
          `SELECT studentName, studentCode, studentKey FROM enrollments WHERE curriculumId = ? AND lower(trim(coalesce(studentCode,''))) = lower(trim(?)) ORDER BY created_at DESC LIMIT 1`,
          [session.curriculumId || '', String(studentCode || '')],
          (err, row) => { if (err) return resolve(null); resolve(row || null); }
        );
      });
      if (enrollmentByCode) {
        const sName = String(enrollmentByCode.studentName || '').trim();
        const sCode = String(enrollmentByCode.studentCode || '').trim();
        if (sName && sCode) canonicalStudentId = `${sName}|${sCode}`;
        else canonicalStudentId = String(enrollmentByCode.studentKey || '').trim() || null;
      }
    }

    // normalize incoming student id to canonical form and respect completion
    if (!canonicalStudentId) canonicalStudentId = await resolveCanonicalProgressStudentId(sessionId, studentId);

    // If the whole session is finished, return completed flag
    if (session.endTime) {
      return res.json({ ok: true, completed: true, message: 'Session already completed' });
    }

    const meta = session.metadata || {};
    // support several possible metadata shapes for per-student completion
    const completedStudents = meta.completedStudents || meta.completedStudentIds || meta.completed || null;
    if (completedStudents) {
      // object map: { studentId: true }
      if (typeof completedStudents === 'object' && !Array.isArray(completedStudents)) {
        if (completedStudents[canonicalStudentId]) return res.json({ ok: true, completed: true, message: 'Student already completed this session' });
      }
      // array of ids
      if (Array.isArray(completedStudents) && completedStudents.includes(canonicalStudentId)) {
        return res.json({ ok: true, completed: true, message: 'Student already completed this session' });
      }
      // boolean true indicates session-level completed (already handled by endTime above)
    }

    // If the session is tied to a curriculum, check if there's a previously completed
    // session for the same curriculum where this student already had progress.
    if (session.curriculumId) {
      const completedSession = await new Promise((resolve) => {
        dataManager.db.get(
          `SELECT id FROM sessions WHERE curriculumId = ? AND endTime IS NOT NULL ORDER BY endTime DESC LIMIT 1`,
          [session.curriculumId],
          (err, row) => {
            if (err) return resolve(null);
            resolve(row || null);
          }
        );
      });
      if (completedSession && completedSession.id) {
        // Build candidate student id list to account for mixed id formats in progress
        const candidates = new Set();
        candidates.add((canonicalStudentId || '').toLowerCase().trim());
        candidates.add((String(studentId || '')).toLowerCase().trim());
        // Also include any enrollment studentKey variants for this student
        try {
          const parsedForEnroll = parseStudentIdentity(studentId || canonicalStudentId);
          const enrollmentsForStudent = await dataManager.getEnrollmentsByStudent(parsedForEnroll.studentKey || `${parsedForEnroll.studentName || ''}|${parsedForEnroll.studentCode || ''}`, parsedForEnroll.studentName || '', parsedForEnroll.studentCode || '');
          for (const e of enrollmentsForStudent || []) {
            if (e.studentKey) candidates.add(String(e.studentKey).toLowerCase().trim());
            if (e.studentCode) candidates.add(String(e.studentCode).toLowerCase().trim());
            if (e.studentName) candidates.add(String(e.studentName).toLowerCase().trim());
          }
        } catch (e) {
          // ignore errors from enrollment lookup
        }

        const candidateArr = Array.from(candidates).filter(Boolean);
        let hasProgress = false;
        if (candidateArr.length) {
          const placeholders = candidateArr.map(() => '?').join(',');
          const params = [completedSession.id, ...candidateArr];
          const sql = `SELECT 1 as exists_flag FROM progress WHERE sessionId = ? AND lower(trim(studentId)) IN (${placeholders}) LIMIT 1`;
          hasProgress = await new Promise((resolve) => {
            dataManager.db.get(sql, params, (err, row) => {
              if (err) return resolve(false);
              resolve(!!row);
            });
          });
        }
        if (hasProgress) {
          return res.json({ ok: true, completed: true, message: 'Student already completed this curriculum in the latest session' });
        }
        // Fuzzy fallback: compare numeric fragments (e.g., '08-01') between incoming id and progress studentIds
        try {
          const fragMatch = String(studentId || canonicalStudentId || '').match(/(\d{2}[-_]?\d{2})/);
          if (fragMatch && fragMatch[1]) {
            const fragNorm = fragMatch[1].replace(/_/g, '-');
            const allProgressIds = await new Promise((resolve) => {
              dataManager.db.all(`SELECT DISTINCT studentId FROM progress WHERE sessionId = ?`, [completedSession.id], (err, rows) => {
                if (err) return resolve([]);
                resolve((rows || []).map(r => r.studentId || ''));
              });
            });
            for (const pid of allProgressIds || []) {
              const m2 = String(pid || '').match(/(\d{2}[-_]?\d{2})/);
              if (m2 && m2[1] && m2[1].replace(/_/g, '-') === fragNorm) {
                return res.json({ ok: true, completed: true, message: 'Student already completed this curriculum (fuzzy match)' });
              }
            }
          }
        } catch (e) {
          // ignore
        }
        // Extra attempt: look up enrollments for the incoming id and check progress for those enrollment keys
        try {
          const parsedForEnroll2 = parseStudentIdentity(studentId || canonicalStudentId);
          const enrollmentsLookup = await dataManager.getEnrollmentsByStudent(parsedForEnroll2.studentKey || `${parsedForEnroll2.studentName || ''}|${parsedForEnroll2.studentCode || ''}`, parsedForEnroll2.studentName || '', parsedForEnroll2.studentCode || '');
          for (const e of enrollmentsLookup || []) {
            if (!e || String(e.curriculumId || '') !== String(session.curriculumId)) continue;
            const found = await new Promise((resolve) => {
              dataManager.db.get(`SELECT 1 as exists_flag FROM progress WHERE sessionId = ? AND lower(trim(studentId)) = lower(trim(?)) LIMIT 1`, [completedSession.id, e.studentKey], (err, row) => {
                if (err) return resolve(false);
                resolve(!!row);
              });
            });
            if (found) return res.json({ ok: true, completed: true, message: 'Student already completed this curriculum in the latest session' });
          }
        } catch (e) {
          // ignore
        }
      }
    }

    // determine difficulty
    meta.difficulties = meta.difficulties || {};
    const difficulty = meta.difficulties[canonicalStudentId] || 2;

    // If student had two consecutive incorrect answers, return a Socratic hint instead
    const last = await dataManager.getLastAnswers(sessionId, canonicalStudentId, 2);
    if (last.length >= 2 && last.every((r) => !r.correct && !r.hintRequested)) {
      // generate hint for the last question
      const lastQuestion = last[0].questionId;
      // find question text
      const qs = await dataManager.getQuestionsBySessionAndStudent(sessionId, canonicalStudentId);
      const q = qs.find((x) => x.questionId === lastQuestion);
      const hintPrompt = `Provide a Socratic hint for the following question that guides the student without giving away the answer:\n\n${q ? q.text : ''}`;
      const hint = await modelManager.generateLocal({ prompt: hintPrompt, temperature: 0.1, maxTokens: 120 });
      // record hint request
      await dataManager.recordAnswer({ sessionId, studentId, questionId: lastQuestion, answer: null, correct: false, hintRequested: true });
      return res.json({ ok: true, hint });
    }

    // build prompt for new question using curriculum context if available
    // Prefer the student's selected/enrolled curriculum over the session's curriculumId
    let curriculumText = '';
    let promptCurriculumId = null;

    // If frontend provided an explicit class selection (dropdown), prefer that curriculum first
    const selectedClass = req.body?.classname || req.body?.className || req.body?.selectedClass || req.body?.selectedClassname || null;
    if (selectedClass) {
      try {
        const parsedSel = parseStudentIdentity(canonicalStudentId || studentId || '');
        const enrollmentRow = await new Promise((resolve) => {
          dataManager.db.get(
            `SELECT * FROM enrollments WHERE lower(trim(classname)) = lower(trim(?)) AND (lower(trim(studentKey)) = lower(trim(?)) OR lower(trim(studentName)) = lower(trim(?) ) OR lower(trim(coalesce(studentCode,''))) = lower(trim(?))) ORDER BY created_at DESC LIMIT 1`,
            [String(selectedClass || ''), parsedSel.raw || '', parsedSel.studentName || '', parsedSel.studentCode || ''],
            (err, row) => { if (err) return resolve(null); resolve(row || null); }
          );
        });
        if (enrollmentRow && enrollmentRow.curriculumId) {
          promptCurriculumId = enrollmentRow.curriculumId;
        } else {
          // fallback: find curriculum by classname
          const found = await dataManager.findCurriculumByClassname(selectedClass);
          if (found && found.id) promptCurriculumId = found.id;
        }
      } catch (e) {
        // ignore and continue to other resolution strategies
      }
    }

    // If frontend supplied an explicit studentCode (class selector), prefer that curriculum
    if (studentCode) {
      try {
        const enrollmentRow = await new Promise((resolve) => {
          dataManager.db.get(
            `SELECT * FROM enrollments WHERE lower(trim(coalesce(studentCode,''))) = lower(trim(?)) ORDER BY created_at DESC LIMIT 1`,
            [String(studentCode || '')],
            (err, row) => { if (err) return resolve(null); resolve(row || null); }
          );
        });
        if (enrollmentRow && enrollmentRow.curriculumId) promptCurriculumId = enrollmentRow.curriculumId;
      } catch (e) {
        // ignore lookup errors and fall back
      }
    }

    // If not resolved yet, attempt to find any enrollment for this canonical student id
    if (!promptCurriculumId && canonicalStudentId) {
      try {
        const parsed = parseStudentIdentity(canonicalStudentId);
        const enrollments = await dataManager.getEnrollmentsByStudent(parsed.studentKey || `${parsed.studentName || ''}|${parsed.studentCode || ''}`, parsed.studentName || '', parsed.studentCode || '');
        if (enrollments && enrollments.length) {
          // pick the most-recent enrollment (dataManager returns ordered list)
          promptCurriculumId = enrollments[0].curriculumId || null;
        }
      } catch (e) {
        // ignore and fall back
      }
    }

    // final fallback to session curriculum
    if (!promptCurriculumId) promptCurriculumId = session.curriculumId || null;

    if (promptCurriculumId) {
      const c = await dataManager.getCurriculum(promptCurriculumId);
      curriculumText = (c && c.metadata && c.metadata.extracted) ? (typeof c.metadata.extracted === 'string' ? c.metadata.extracted : JSON.stringify(c.metadata.extracted).slice(0,2000)) : '';
    }

    const prompt = `Create a ${['easy','medium','hard'][difficulty-1] || 'medium'} level question for grade ${grade || 'unknown'} on subject ${subject || 'general'}${curriculumText ? '\n\nContext:\n' + curriculumText : ''}. Provide a clear single question.`;

    // Try to capture the raw assistant reply (including possible thinking blocks) with a large budget
    let rawResp = null;
    try {
      // prefer the raw response object so we can inspect .message.thinking when present
      rawResp = await modelManager.generateLocalRawResponse({ prompt, temperature: 0.2, maxTokens: 1200 });
    } catch (e) {
      console.error('[session/next] generateLocalRawResponse failed, falling back to generateLocal:', e.message || e);
      // fallback: use the cleaned generateLocal which applies cleaning heuristics
      const questionTextFallback = await modelManager.generateLocal({ prompt, temperature: 0.2, maxTokens: 200 });
      const qidFallback = `q-${uuidv4()}`;
      await dataManager.createQuestion({ id: `qrec-${uuidv4()}`, sessionId, studentId: canonicalStudentId, questionId: qidFallback, text: questionTextFallback, difficulty });
      return res.json({ ok: true, questionId: qidFallback, question: questionTextFallback, difficulty, fallback: true });
    }

    // Helper to extract a final candidate from the assistant reply
    const extractFinalCandidate = (dataObj) => {
      try {
        if (!dataObj) return '';
        const content = String(dataObj?.message?.content || '').trim();
        const thinking = String(dataObj?.message?.thinking || dataObj?.response || '').trim();
        const pick = content || thinking || '';
        if (!pick) return '';

        // Prefer content if present; otherwise look for final markers in thinking
        let value = pick;
        const doneThinkingRegex = /(?:\.{0,5}\s*)?done thinking\s*[:\.\-\>\)]{0,3}/ig;
        let lastMatch = null;
        let match;
        while ((match = doneThinkingRegex.exec(value)) !== null) {
          lastMatch = { index: match.index, match: match[0] };
        }
        if (lastMatch && lastMatch.index !== undefined) {
          value = value.slice(lastMatch.index + lastMatch.match.length).trim();
        }

        // Remove common analysis prefixes
        value = value.replace(/^\s*(Analysis|Thinking|Reasoning)[:\-\s]*/i, '').trim();

        // Return the last non-empty line which often contains the final question
        const lines = value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length) return lines[lines.length - 1];
        return value;
      } catch (e) {
        return '';
      }
    };

    let questionCandidate = extractFinalCandidate(rawResp);

    // If candidate looks empty or like analysis, attempt an explicit conversion: ask the model to convert its reply into JSON
    const looksLikeAnalysis = (txt) => {
      if (!txt) return true;
      const v = String(txt).toLowerCase();
      return v.includes('analysis') || v.includes('role:') || v.includes('task:') || v.includes('constraint:') || v.includes('thinking');
    };

    if (!questionCandidate || looksLikeAnalysis(questionCandidate) || questionCandidate.length < 10) {
      try {
        const conversionPrompt = [
          'The assistant reply below may contain internal reasoning and analysis. Extract and return EXACTLY one clear question (only the question text) in JSON format like: {"question":"..."}. Do not include any other text or commentary.',
          '',
          'ASSISTANT_REPLY:',
          String(rawResp?.message?.content || rawResp?.message?.thinking || rawResp?.response || '')
        ].join('\n');

        const convResp = await modelManager.generateLocalRawResponse({ prompt: conversionPrompt, temperature: 0.0, maxTokens: 800 });
        const convContent = String(convResp?.message?.content || '').trim() || String(convResp?.message?.thinking || convResp?.response || '').trim();
        // Try to parse JSON
        try {
          const parsed = JSON.parse(convContent);
          if (parsed && parsed.question) questionCandidate = String(parsed.question).trim();
        } catch (jsonErr) {
          // If content is not strict JSON, try to extract question-like substring
          const extracted = extractFinalCandidate({ message: { content: convContent } });
          if (extracted && extracted.length >= 8) questionCandidate = extracted;
        }

        // Log conversion attempt
        try {
          const logPath = require('path').join(__dirname, '..', 'question_debug.log');
          const logEntry = { ts: Date.now(), sessionId, studentId: canonicalStudentId, promptPreview: prompt.slice(0, 400), rawPreview: String(rawResp?.message?.thinking || rawResp?.message?.content || '').slice(0, 800), conversionPreview: convContent.slice(0, 800), extracted: questionCandidate ? questionCandidate.slice(0,200) : null };
          require('fs').appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
        } catch (e) {
          console.error('[session/next] Failed writing question_debug log:', e.message || e);
        }
      } catch (convErr) {
        console.error('[session/next] conversion attempt failed:', convErr.message || convErr);
      }
    }

    // Final fallback: if still no good candidate, use sanitized generateLocal fallback
    if (!questionCandidate || questionCandidate.length < 8) {
      const fallbackText = await modelManager.generateLocal({ prompt: `Provide a single clear question about: ${subject || 'general'}${curriculumText ? '\n\nContext:\n' + curriculumText : ''}.`, temperature: 0.0, maxTokens: 200 });
      questionCandidate = fallbackText;
    }

    const qid = `q-${uuidv4()}`;
    await dataManager.createQuestion({ id: `qrec-${uuidv4()}`, sessionId, studentId: canonicalStudentId, questionId: qid, text: questionCandidate, difficulty });

    res.json({ ok: true, questionId: qid, question: questionCandidate, difficulty });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Session replay
app.get('/api/session/replay', async (req, res) => {
  try {
    const { sessionId, studentId } = req.query;
    if (!sessionId || !studentId) return res.status(400).json({ ok: false, error: 'sessionId and studentId required' });
    const transcript = await dataManager.getTranscript(sessionId, studentId);
    res.json({ ok: true, transcript });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Export CSV
app.get('/api/teacher/export', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
    const rows = await dataManager.getSessionProgress(sessionId);
    const csv = ['studentId,questionId,answer,correct,hintRequested,timestamp', ...rows.map(r => `${r.studentId},${r.questionId},"${(r.answer||'').replace(/"/g,'""')}",${r.correct},${r.hintRequested},${r.timestamp}`)].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="session-${sessionId}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Record hint request
app.post('/api/session/hint', async (req, res) => {
  try {
    const {
      sessionId,
      studentId,
      questionId,
      question,
      className,
      subject,
      curriculumOutline,
      studentName,
      studentCode
    } = req.body;

    const questionText = String(question || '').trim();
    if (!questionText) return res.status(400).json({ ok: false, error: 'question required' });

    const hintLogContext = {
      questionId: questionId || null,
      questionPreview: questionText.slice(0, 120),
      className: className || null,
      subject: subject || null,
      studentName: studentName || null,
      studentCode: studentCode || null
    };

    console.log('[session/hint] Request received', hintLogContext);

    const looksLikeAnalysisText = (text) => {
      const value = String(text || '').trim();
      return !value ||
        /^\s*1\.\s*\*\*Analyze/i.test(value) ||
        value.toLowerCase().includes('analyze the request') ||
        value.toLowerCase().includes('role:') ||
        value.toLowerCase().includes('task:') ||
        value.toLowerCase().includes('constraint:') ||
        value.toLowerCase().includes('question:');
    };

    const looksLikeGenericHint = (text) => {
      const value = String(text || '').trim().toLowerCase();
      return !value ||
        value.includes('start with the concept') ||
        value.includes('add one classroom example') ||
        value.includes('break the problem into smaller parts') ||
        value.includes('try breaking the problem into smaller parts') ||
        value.includes('consider how') ||
        value.includes('think about how') ||
        value.includes('consider the structure') ||
        value.includes('consider how the structure') ||
        value.includes('ask yourself how') ||
        value.includes('what property of image data') ||
        value.includes('what property of the image data');
    };

    const extractFinalHintCandidate = (text) => {
      let value = String(text || '').trim();
      if (!value) return '';

      // Prefer content after an explicit "done thinking" marker. Models sometimes emit lengthy
      // analysis in `message.thinking` and then append the final output after a marker like
      // "...done thinking.". Find the last occurrence and take the substring after it.
      const doneThinkingRegex = /(?:\.{0,5}\s*)?done thinking\s*[:\.\-\>\)]{0,3}/ig;
      let lastMatch = null;
      let match;
      while ((match = doneThinkingRegex.exec(value)) !== null) {
        lastMatch = { index: match.index, match: match[0] };
      }
      if (lastMatch && lastMatch.index !== undefined) {
        value = value.slice(lastMatch.index + lastMatch.match.length).trim();
      }

      // Also support explicit final markers like 'Final hint:', 'Final output:', or 'Final:'
      const finalMarkers = [/final hint\s*[:\-]/i, /final output\s*[:\-]/i, /final\s*[:\-]\s*/i, /output only\s*[:\-]/i];
      for (const pat of finalMarkers) {
        const fm = value.match(pat);
        if (fm && fm.index !== undefined) {
          value = value.slice(fm.index + fm[0].length).trim();
          break;
        }
      }

      const lines = value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^\d+\./.test(line))
        .filter((line) => !/^\*+/.test(line));

      if (lines.length) {
        // Return the last non-empty, non-numbered line which often contains the final hint
        return lines[lines.length - 1].trim();
      }

      return value.trim();
    };

    let curriculumText = '';
    if (curriculumOutline) {
      curriculumText = typeof curriculumOutline === 'string' ? curriculumOutline : JSON.stringify(curriculumOutline).slice(0, 2000);
    } else if (subject || className) {
      curriculumText = `Class: ${className || 'unknown'}\nSubject: ${subject || 'unknown'}`;
    }

    const hintPrompt = [
      `You are a tutor for ${className || subject || 'this class'}.`,
      `Write ONE Socratic hint for the question below.`,
      `The hint must guide the student toward the answer without giving it away.`,
      `Avoid generic advice like "start with the concept" unless you also mention a curriculum-specific idea.`,
      curriculumText ? `Curriculum context:\n${curriculumText}` : '',
      `Question:\n${questionText}`,
      `Return only the hint sentence.`
    ].filter(Boolean).join('\n\n');

    const rawHintResponse = await modelManager.generateLocalRawResponse({ prompt: hintPrompt, temperature: 0.15, maxTokens: 140 });
    const rawHintContent = String(rawHintResponse?.message?.content || '').trim();
    const rawHintThinking = String(rawHintResponse?.message?.thinking || rawHintResponse?.response || '').trim();
    const hint = extractFinalHintCandidate(rawHintContent || rawHintThinking || '');
    const isUnusableHint = looksLikeAnalysisText(hint) || looksLikeGenericHint(hint);
    if (isUnusableHint) {
      console.error('[session/hint] Gemma4 returned unusable hint', {
        ...hintLogContext,
        rawHintContentPreview: rawHintContent.slice(0, 120),
        rawHintThinkingPreview: rawHintThinking.slice(0, 120),
        extractedHintPreview: String(hint || '').trim().slice(0, 120)
      });
      const rewritePrompt = [
        `Rewrite the assistant reply below into a single concise Socratic hint.`,
        `The output must be a short classroom hint, not analysis, not role labels, and not step-by-step reasoning.`,
        `Do not use phrases like "Analyze the Request", "Role:", "Task:", or "Constraint:".`,
        `Keep the hint curriculum-specific and directly tied to the question.`,
        `Return only the hint sentence.`,
        '',
        `QUESTION:\n${questionText}`,
        '',
        `ASSISTANT_REPLY:\n${rawHintContent || rawHintThinking}`
      ].join('\n');

      const rawRewriteResponse = await modelManager.generateLocalRawResponse({ prompt: rewritePrompt, temperature: 0.1, maxTokens: 120 });
      const rawRewriteContent = String(rawRewriteResponse?.message?.content || '').trim();
      const rawRewriteThinking = String(rawRewriteResponse?.message?.thinking || rawRewriteResponse?.response || '').trim();
      const rewrittenHint = extractFinalHintCandidate(rawRewriteContent || rawRewriteThinking || '');
      console.log('[session/hint] Rewrite raw result:');
      console.log(rawRewriteResponse);
      console.log('[session/hint] Rewrite cleaned:');
      console.log(rewrittenHint);

      // If the rewrite looks like analysis or the model truncated the output (done_reason==='length'),
      // attempt a follow-up explicit "final-only" request with more tokens. As a last resort call
      // generateLocal (which injects a SYSTEM instruction) to try to suppress chain-of-thought.
      const wasTruncated = String(rawRewriteResponse?.done_reason || '').toLowerCase() === 'length';
      if (looksLikeAnalysisText(rewrittenHint) || looksLikeGenericHint(rewrittenHint) || wasTruncated) {
        console.error('[session/hint] Gemma4 rewrite still unusable or truncated', {
          ...hintLogContext,
          rewritePreview: String(rewrittenHint || '').trim().slice(0, 120),
          done_reason: rawRewriteResponse?.done_reason || null
        });

        // 1) Try an explicit final-only follow-up with higher token budget
        try {
          const finalOnlyPrompt = [
            `FINAL HINT ONLY: Output exactly ONE concise Socratic hint sentence for the question below. Do NOT include analysis, role labels, or step-by-step reasoning.`,
            `Keep it curriculum-specific and directly tied to the question.`,
            `QUESTION:\n${questionText}`,
            '',
            `ASSISTANT_REPLY:\n${rawRewriteContent || rawRewriteThinking}`
          ].join('\n\n');

          // Give the model a much larger budget for the final-only extraction to avoid truncation.
          const finalAttempt = await modelManager.generateLocalRawResponse({ prompt: finalOnlyPrompt, temperature: 0.05, maxTokens: 1200 });
          const finalContent = String(finalAttempt?.message?.content || '').trim();
          const finalThinking = String(finalAttempt?.message?.thinking || finalAttempt?.response || '').trim();
          const finalHint = extractFinalHintCandidate(finalContent || finalThinking || '');

          console.log('[session/hint] Final-only attempt result:');
          console.log(finalAttempt);
          console.log('[session/hint] Final-only cleaned:');
          console.log(finalHint);

          if (!looksLikeAnalysisText(finalHint) && !looksLikeGenericHint(finalHint)) {
            if (sessionId && studentId && questionId) {
              await dataManager.recordAnswer({ sessionId, studentId, questionId, answer: null, correct: false, hintRequested: true });
            } else if (studentName && studentCode && questionId) {
              console.log('[session/hint] Hint generated without session tracking', { studentName, studentCode, questionId });
            }

            return res.json({ ok: true, hint: finalHint });
          }
        } catch (followErr) {
          console.warn('[session/hint] Final-only follow-up failed:', followErr.message || followErr);
        }

        // 2) Last-resort: use generateLocal (which injects a SYSTEM instruction to suppress reasoning)
        try {
          // Try with a larger maxTokens so the model can finish any trailing final output
          const cleanedFinal = await modelManager.generateLocal({ prompt: `FINAL HINT ONLY: Output exactly ONE concise Socratic hint sentence for the question below. Do NOT include analysis, role labels, or step-by-step reasoning.\n\nQUESTION:\n${questionText}`, temperature: 0.0, maxTokens: 800 });
          const cleanedCandidate = String(cleanedFinal || '').trim();
          console.log('[session/hint] generateLocal final attempt cleaned:', cleanedCandidate.slice(0, 1200));
          if (cleanedCandidate && !looksLikeAnalysisText(cleanedCandidate) && !looksLikeGenericHint(cleanedCandidate)) {
            if (sessionId && studentId && questionId) {
              await dataManager.recordAnswer({ sessionId, studentId, questionId, answer: null, correct: false, hintRequested: true });
            } else if (studentName && studentCode && questionId) {
              console.log('[session/hint] Hint generated without session tracking', { studentName, studentCode, questionId });
            }
            return res.json({ ok: true, hint: cleanedCandidate });
          }
        } catch (finalErr) {
          console.warn('[session/hint] generateLocal final attempt failed:', finalErr.message || finalErr);
        }

        // If we reach here, all recovery attempts failed
        console.error('[session/hint] All recovery attempts failed; giving up and returning error', { ...hintLogContext });
        throw new Error('Gemma4 failed to generate a usable hint');
      }

      console.log('[session/hint] Gemma4 hint rewritten successfully', {
        ...hintLogContext,
        hintPreview: rewrittenHint.slice(0, 120)
      });

      if (sessionId && studentId && questionId) {
        await dataManager.recordAnswer({ sessionId, studentId, questionId, answer: null, correct: false, hintRequested: true });
      } else if (studentName && studentCode && questionId) {
        console.log('[session/hint] Hint generated without session tracking', { studentName, studentCode, questionId });
      }

      return res.json({ ok: true, hint: rewrittenHint });
    }

    console.log('[session/hint] Gemma4 hint generated', {
      ...hintLogContext,
      hintPreview: hint.slice(0, 120)
    });

    if (sessionId && studentId && questionId) {
      await dataManager.recordAnswer({ sessionId, studentId, questionId, answer: null, correct: false, hintRequested: true });
    } else if (studentName && studentCode && questionId) {
      console.log('[session/hint] Hint generated without session tracking', { studentName, studentCode, questionId });
    }

    res.json({ ok: true, hint });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Teacher dashboard
app.get('/api/teacher/dashboard', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
    const dashboard = await dataManager.getDashboard(sessionId);
    res.json({ ok: true, dashboard });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/teacher/roster', async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    const curriculumId = String(req.query.curriculumId || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    const roster = await dataManager.listEnrollmentsByTeacher(teacherId, curriculumId || null);
    res.json({ ok: true, roster });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/teacher/transcript', async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    const curriculumId = String(req.query.curriculumId || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    const transcriptData = await dataManager.getLatestTranscriptForTeacher(teacherId, curriculumId || null);
    res.json({ ok: true, ...transcriptData });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Start server (after all routes are defined)
app.listen(port, async () => {
  try {
    const biologyCurriculum = await dataManager.findCurriculumByClassname('Grade 6 Biology');
    if (biologyCurriculum) {
      for (const student of [
        { studentName: 'Aanya', studentCode: 'BRIDGE-41' },
        { studentName: 'Omar', studentCode: 'BRIDGE-41' }
      ]) {
        await dataManager.enrollStudent({
          studentName: student.studentName,
          studentCode: student.studentCode,
          curriculumId: biologyCurriculum.id,
          teacherId: biologyCurriculum.teacherId || null,
          classname: biologyCurriculum.classname || biologyCurriculum.metadata?.classname || biologyCurriculum.filename || 'Grade 6 Biology'
        });
      }
    }
  } catch (err) {
    console.warn('Demo enrollment seeding skipped:', err.message);
  }

  try {
    const sessionCount = await new Promise((resolve) => {
      dataManager.db.get(`SELECT COUNT(*) AS cnt FROM sessions`, [], (err, row) => {
        if (err) return resolve(0);
        resolve(row?.cnt || 0);
      });
    });

    if (!sessionCount) {
      const demoCurriculum = await dataManager.findCurriculumByClassname('Grade 6 Computer Science')
        || await dataManager.findCurriculumByClassname('Grade 6 Biology');

      if (demoCurriculum) {
        const enrolledStudent = await new Promise((resolve) => {
          dataManager.db.get(
            `SELECT studentName, studentCode FROM enrollments WHERE curriculumId = ? ORDER BY created_at ASC LIMIT 1`,
            [demoCurriculum.id],
            (err, row) => {
              if (err) return resolve(null);
              resolve(row || null);
            }
          );
        });

        if (enrolledStudent?.studentName) {
          const demoStudentId = `u-${uuidv4()}`;
          const demoSessionId = `s-${uuidv4()}`;
          await dataManager.createStudent({ id: demoStudentId, name: enrolledStudent.studentName });
          await dataManager.createSession({
            id: demoSessionId,
            title: `${demoCurriculum.classname || demoCurriculum.filename || 'Demo'} session`,
            curriculumId: demoCurriculum.id,
            joinCode: 'DEMO',
            startTime: Date.now() - 45 * 60 * 1000,
            endTime: null,
            metadata: {
              demoSeed: true,
              demoStudentId,
              demoStudentName: enrolledStudent.studentName
            }
          });

          const demoQuestions = [
            {
              questionId: `demo-q-${uuidv4()}`,
              text: 'How does algorithmic thinking help a computer science program solve a problem?',
              answer: 'It breaks the problem into clear steps that the program can follow.',
              correct: true,
              hintRequested: false
            },
            {
              questionId: `demo-q-${uuidv4()}`,
              text: 'Why is debugging an important part of building software?',
              answer: 'It helps find mistakes so the program works the way we expect.',
              correct: true,
              hintRequested: false
            },
            {
              questionId: `demo-q-${uuidv4()}`,
              text: 'What would happen if we skipped testing before shipping the app?',
              answer: 'Users could run into errors and the app might not behave correctly.',
              correct: false,
              hintRequested: true
            }
          ];

          for (const item of demoQuestions) {
            await dataManager.createQuestion({
              id: `qrec-${uuidv4()}`,
              sessionId: demoSessionId,
              studentId: demoStudentId,
              questionId: item.questionId,
              text: item.text,
              difficulty: 2
            });
            await dataManager.recordAnswer({
              sessionId: demoSessionId,
              studentId: demoStudentId,
              questionId: item.questionId,
              answer: item.answer,
              correct: item.correct,
              hintRequested: item.hintRequested
            });
          }

          console.log(`[STARTUP] Seeded demo transcript for ${enrolledStudent.studentName} in ${demoCurriculum.classname || demoCurriculum.filename}`);
        }
      }
    }
  } catch (err) {
    console.warn('Demo transcript seeding skipped:', err.message);
  }

  await modelManager.warmup();

  // Re-enqueue any curricula left in 'queued' extraction state (resume after reboot)
  try {
    const pending = await dataManager.listCurriculaWithStatus('queued');
    if (pending && pending.length) {
      console.log(`[STARTUP] Resuming ${pending.length} queued extractions...`);
      for (const cur of pending) {
        const id = cur.id;
        const filename = cur.filename || '';
        const meta = cur.metadata || {};
        
        // Try to regenerate extraction prompt from PDF or saved extractedText
        let extractionPrompt = null;
        let textToExtract = meta.extractedText || null;
        
        // If no extractedText, try to re-read the PDF file
        if (!textToExtract && filename) {
          try {
            const uploadedFilePath = path.join(UPLOAD_DIR, filename);
            if (fs.existsSync(uploadedFilePath)) {
              console.log(`[STARTUP] Re-analyzing PDF for ${id.substring(0, 8)}: ${filename}`);
              const { text } = await analyzePdf(uploadedFilePath);
              if (text && text.length > 100) {
                textToExtract = text;
              }
            }
          } catch (readErr) {
            console.warn(`[STARTUP] Failed to re-read PDF for ${id}:`, readErr.message);
          }
        }
        
        // If we have text, create prompt
        if (textToExtract && textToExtract.length > 100) {
          extractionPrompt = `You are a JSON extraction assistant. Your response MUST be ONLY valid JSON, no other text.

Extract from this text and return ONLY this JSON structure:
{
  "title": "extracted title",
  "objectives": ["objective 1", "objective 2", "objective 3"],
  "vocabulary": ["term1", "term2", "term3", "term4", "term5"],
  "outline": [{"section": "section name", "bullets": ["point 1", "point 2"]}]
}

TEXT TO EXTRACT FROM:
${String(textToExtract).substring(0, 3000)}`;
        } else {
          console.warn(`[STARTUP] Skipping ${id}: no text source (no extractedText, no PDF, or PDF unreadable)`);
          continue;
        }
        
        // Enqueue with regenerated prompt
        enqueueExtraction(async () => {
          try {
            console.log(`[EXTRACT] Started for ${id.substring(0, 8)}... (startup resume)`);
            const extractionRaw = await modelManager.generateLocalRawWithRetry({
              prompt: extractionPrompt,
              temperature: 0.0,
              maxTokens: 1200,
              attempts: 4,
              initialDelay: 3000
            });
            const curriculum = await dataManager.getCurriculum(id);
            if (!curriculum) return;
            const meta2 = curriculum.metadata || {};
            meta2.extracted = extractionRaw;
            meta2.extractionStatus = 'complete';
            await dataManager.updateCurriculum(id, meta2);
            console.log(`[EXTRACT] Completed for ${id.substring(0, 8)}...`);
          } catch (bgErr) {
            console.warn(`[EXTRACT] Failed for ${id.substring(0, 8)}:`, bgErr.message);
            const curriculum = await dataManager.getCurriculum(id);
            if (!curriculum) return;
            const meta2 = curriculum.metadata || {};
            meta2.extractionStatus = 'failed';
            meta2.processingWarning = `extraction_failed:${bgErr.message}`;
            await dataManager.updateCurriculum(id, meta2);
          }
        });
        
      }
    }
  } catch (rqErr) {
    console.warn('[STARTUP] Failed to resume queued extractions:', rqErr.message);
  }
  console.log(`BridgeLearn backend running on http://localhost:${port}`);
});

// Evaluate student answers and return structured result { correct, reason, hint }
app.post('/api/evaluate', async (req, res) => {
  try {
    const question = String(req.body.question || '').trim();
    const answer = String(req.body.answer || '').trim();
    if (!question) return res.status(400).json({ ok: false, error: 'question is required' });
    if (!answer) return res.status(400).json({ ok: false, error: 'answer is required' });

    console.log('[/api/evaluate] Incoming request:');
    console.log('[/api/evaluate] Question:', question);
    console.log('[/api/evaluate] Answer:', answer);

    const isPlaceholderAnswer = (value) => {
      const text = String(value || '').trim().toLowerCase();
      if (!text) return true;
      if (text.length < 4) return true;
      if (/^(blah|blah blah|lorem|lorem ipsum|asdf|qwerty|xxx|test|dummy|n\/a|na|idk|i don'?t know|don'?t know|nothing|whatever|maybe|yes|no|ok|okay)([\s.!?,]|$)/i.test(text)) {
        return true;
      }

      const tokens = text.match(/[a-z0-9_]+/g) || [];
      const uniqueTokens = new Set(tokens);
      const repetitionRatio = tokens.length ? uniqueTokens.size / tokens.length : 0;
      if (repetitionRatio <= 0.5 && tokens.length <= 6) return true;
      return false;
    };

    if (isPlaceholderAnswer(answer)) {
      const hint = 'Your answer is too generic. Restate the key concept from the question and connect it to a concrete example.';
      console.log('[/api/evaluate] Placeholder answer rejected before model evaluation.');
      return res.json({
        ok: true,
        correct: false,
        reason: 'The answer is too generic to count as correct.',
        hint,
        raw: 'placeholder-answer-rejected'
      });
    }

    // Build evaluation prompt: ask for JSON only
    const evalSystem = 'SYSTEM: You are an objective evaluator. DO NOT produce chain-of-thought. Output ONLY valid JSON.';
    const evalPrompt = `${evalSystem}\n\nProduce JSON with keys: correct (true/false), reason (one-sentence), and hint (a concise hint that helps the student without giving away the full answer).\n\nQuestion: ${question}\nStudentAnswer: ${answer}\n\nRespond with JSON only.`;

    console.log('[/api/evaluate] Evaluation prompt:');
    console.log(evalPrompt);

    // Primary attempt: ask model for JSON
    let raw = await modelManager.generateLocalRaw({ prompt: evalPrompt, temperature: 0.0, maxTokens: 180 });
    let parsed = null;

    console.log('[/api/evaluate] Raw model response:');
    console.log(raw);

    // try to extract JSON object from raw
    const tryExtractJSON = (text) => {
      if (!text) return null;
      const m = text.match(/\{[\s\S]*\}/m);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch (e) {
          return null;
        }
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    };

    parsed = tryExtractJSON(raw);

    console.log('[/api/evaluate] Parsed JSON from primary response:', parsed);

    // If parsing failed, attempt extraction pass
    if (!parsed) {
      const extractPrompt = `Extract valid JSON from the assistant reply below. If no JSON present, create JSON with keys correct (true/false), reason, and hint based on the question and student's answer. ASSISTANT_REPLY:\n${raw}\n\nQuestion:\n${question}\nStudentAnswer:\n${answer}`;
      try {
        const raw2 = await modelManager.generateLocalRaw({ prompt: extractPrompt, temperature: 0.0, maxTokens: 160 });
        parsed = tryExtractJSON(raw2);
        raw = raw2;
        console.log('[/api/evaluate] Raw extraction response:');
        console.log(raw2);
        console.log('[/api/evaluate] Parsed JSON from extraction response:', parsed);
      } catch (e) {
        // continue to fallback
        console.error('[/api/evaluate] Extraction pass failed:', e.message || e);
      }
    }

    // If still no parsed JSON, synthesize a conservative result
    if (!parsed) {
      // Basic heuristic: mark incorrect unless answer repeats terms from question
      const qWords = (question.match(/[A-Za-z0-9_]+/g) || []).slice(0, 20).map(s => s.toLowerCase());
      const aWords = (answer.match(/[A-Za-z0-9_]+/g) || []).map(s => s.toLowerCase());
      const overlap = aWords.filter(w => qWords.includes(w)).length;
      const heuristicCorrect = overlap >= Math.min(3, Math.floor(qWords.length / 6));
      parsed = {
        correct: heuristicCorrect,
        reason: heuristicCorrect ? 'Answer appears to match question keywords (heuristic).' : 'Answer does not appear to address the question (heuristic).',
        hint: heuristicCorrect ? '' : `Try relating your answer to ${qWords.slice(0,3).join(', ')} and give a concrete example.`
      };
      console.log('[/api/evaluate] Heuristic fallback result:', parsed);
    }

    // Ensure fields
    parsed.correct = Boolean(parsed.correct);
    parsed.reason = String(parsed.reason || '').trim();
    parsed.hint = String(parsed.hint || '').trim();

    if (!parsed.correct && !parsed.hint) {
      parsed.hint = 'Restate the core idea from the question and add one concrete example.';
    }

    console.log('[/api/evaluate] Final evaluation result:', parsed);

    res.json({ ok: true, correct: parsed.correct, reason: parsed.reason, hint: parsed.hint, raw });
  } catch (err) {
    console.error('[/api/evaluate] Evaluation error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Evaluation failed' });
  }
});

// Dashboard metrics for teacher (aggregated from DB)
// Note: dashboard-metrics is implemented earlier in the file (includes active-duration computation).
// The duplicate handler that lived here was removed to avoid inconsistent metric calculations.

// List recent sessions for a teacher
app.get('/api/teacher/sessions', async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    const curriculumId = String(req.query.curriculumId || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    const curriculumClause = curriculumId ? 'AND s.curriculumId = ?' : '';
    const params = curriculumId ? [teacherId, curriculumId] : [teacherId];
    dataManager.db.all(
      `SELECT s.*, COUNT(p.id) AS progressCount
       FROM sessions s
       LEFT JOIN curricula c ON s.curriculumId = c.id
       LEFT JOIN progress p ON p.sessionId = s.id
       WHERE c.teacherId = ? ${curriculumClause}
       GROUP BY s.id
       ORDER BY CASE WHEN COUNT(p.id) > 0 THEN 0 ELSE 1 END, COALESCE(s.endTime, s.created_at) DESC
       LIMIT 20`,
      params,
      (err, rows) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        const parsed = (rows || []).map((r) => {
          try { r.metadata = r.metadata ? JSON.parse(r.metadata) : {}; } catch (e) { r.metadata = {}; }
          r.progressCount = Number(r.progressCount || 0);
          return r;
        });
        res.json({ ok: true, sessions: parsed });
      }
    );
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/teacher/roster', async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    const curriculumId = String(req.query.curriculumId || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    const roster = await dataManager.listEnrollmentsByTeacher(teacherId, curriculumId || null);
    res.json({ ok: true, roster });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/teacher/transcript', async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    const curriculumId = String(req.query.curriculumId || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    const transcriptData = await dataManager.getLatestTranscriptForTeacher(teacherId, curriculumId || null);
    res.json({ ok: true, ...transcriptData });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/teacher/roster', async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    const curriculumId = String(req.query.curriculumId || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    const roster = await dataManager.listEnrollmentsByTeacher(teacherId, curriculumId || null);
    res.json({ ok: true, roster });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/teacher/transcript', async (req, res) => {
  try {
    const teacherId = String(req.query.teacherId || '').trim();
    const curriculumId = String(req.query.curriculumId || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    const transcriptData = await dataManager.getLatestTranscriptForTeacher(teacherId, curriculumId || null);
    res.json({ ok: true, ...transcriptData });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Session-level dashboard (progress metrics)
app.get('/api/session/dashboard', async (req, res) => {
  try {
    const sessionId = String(req.query.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId required' });
    const dashboard = await dataManager.getDashboard(sessionId);
    res.json({ ok: true, metrics: dashboard });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST-based delete fallback for environments where DELETE may be blocked
app.post('/api/teacher/curriculum/:id/delete', async (req, res) => {
  try {
    const id = req.params.id;
    const curriculum = await dataManager.getCurriculum(id);
    if (!curriculum) return res.status(404).json({ ok: false, error: 'Curriculum not found' });

    try {
      if (curriculum.filename) {
        const filePath = path.join(UPLOAD_DIR, curriculum.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        const pagesDir = path.join(UPLOAD_DIR, id);
        if (fs.existsSync(pagesDir)) {
          const files = fs.readdirSync(pagesDir);
          for (const f of files) {
            try { fs.unlinkSync(path.join(pagesDir, f)); } catch (e) {}
          }
          try { fs.rmdirSync(pagesDir); } catch (e) {}
        }
      }
    } catch (fsErr) {
      console.warn('[DELETE CURR POST] File cleanup failed:', fsErr.message || fsErr);
    }

    await dataManager.deleteCurriculum(id);
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Preview assign: returns how many enrollments would be affected by assigning a curriculum to a classname
app.post('/api/teacher/preview-assign', async (req, res) => {
  try {
    const teacherId = req.body.teacherId || req.headers['x-teacher-id'];
    const classname = String(req.body.classname || '').trim();
    if (!teacherId) return res.status(400).json({ ok: false, error: 'teacherId required' });
    if (!classname) return res.status(400).json({ ok: false, error: 'classname required' });
    const count = await dataManager.countEnrollmentsForClass(teacherId, classname);
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});