const axios = require('axios');
const fs = require('fs');

class ModelManager {
  constructor() {
    this.strategy = (process.env.MODEL_STRATEGY || 'offline').toLowerCase();
    this.offlineOnly = process.env.OFFLINE_ONLY !== 'false';
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.ollamaModel = process.env.OLLAMA_MODEL || 'bridgelearn-gemma-4-e2b-q4';
    this.thinkingEnabled = process.env.THINKING_ENABLED === 'true';
    this.cloudEnabled = this.strategy === 'hybrid' && Boolean(process.env.GEMMA_CLOUD_API_KEY || process.env.GOOGLE_API_KEY);
    this.cloudApiKey = process.env.GEMMA_CLOUD_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.cloudModel = process.env.CLOUD_MODEL || 'gemini-2.5-flash';
    this.summaryByDefault = process.env.SUMMARY_BY_DEFAULT === 'true';
  }

  async warmup() {
    await this.getStatus();
  }

  getConfig() {
    return {
      strategy: this.strategy,
      offlineOnly: this.offlineOnly,
      ollamaUrl: this.ollamaUrl,
      ollamaModel: this.ollamaModel,
      thinkingEnabled: this.thinkingEnabled,
      cloudEnabled: this.cloudEnabled,
      cloudModel: this.cloudModel,
      summaryByDefault: this.summaryByDefault
    };
  }

  _buildSystemInstruction({ thinkingEnabled = this.thinkingEnabled, jsonOnly = false } = {}) {
    const base = jsonOnly
      ? 'SYSTEM: Do NOT output chain-of-thought, internal reasoning, or analysis. If the user asked for a JSON extraction, respond with ONLY valid JSON and no surrounding explanation or commentary.'
      : 'SYSTEM: Do NOT output chain-of-thought or internal reasoning. If you would normally show step-by-step analysis, suppress it and output ONLY the final requested content. When asked to produce a single question, output exactly one question sentence and nothing else.';

    // Gemma thinking is activated by a special token at the start of the system prompt.
    // Keep it opt-in so question generation can default to non-thinking mode.
    return thinkingEnabled ? `<|think|>\n${base}` : base;
  }

  async getStatus() {
    const local = await this.checkLocal();
    const cloud = this.checkCloud();
    return {
      strategy: this.strategy,
      offlineOnly: this.offlineOnly,
      local,
      cloud
    };
  }

  async checkLocal() {
    try {
      const { data } = await axios.get(`${this.ollamaUrl}/api/tags`, { timeout: 10000 });
      const models = Array.isArray(data?.models) ? data.models : [];
      const available = models.some((model) => model.name === this.ollamaModel || model.name.includes(this.ollamaModel));
      return {
        available,
        provider: 'ollama',
        model: this.ollamaModel,
        url: this.ollamaUrl,
        details: available ? 'Custom local model available' : 'Model not found in Ollama tags'
      };
    } catch (error) {
      return {
        available: false,
        provider: 'ollama',
        model: this.ollamaModel,
        url: this.ollamaUrl,
        details: error.message
      };
    }
  }

  checkCloud() {
    return {
      available: this.cloudEnabled,
      provider: 'cloud',
      model: this.cloudModel,
      details: this.cloudEnabled ? 'Cloud fallback enabled' : 'Cloud fallback disabled'
    };
  }

  async generate({ prompt, temperature, maxTokens }) {
    const local = await this.checkLocal();
    if (local.available) {
      const response = await this.generateLocal({ prompt, temperature, maxTokens });
      return {
        source: 'local',
        model: this.ollamaModel,
        text: response,
        fallbackUsed: false
      };
    }

    if (!this.offlineOnly && this.cloudEnabled) {
      const response = await this.generateCloud({ prompt, temperature, maxTokens });
      return {
        source: 'cloud',
        model: this.cloudModel,
        text: response,
        fallbackUsed: true
      };
    }

    throw new Error('Local model is unavailable and cloud fallback is disabled');
  }

  async generateLocal({ prompt, temperature, maxTokens, thinkingEnabled = this.thinkingEnabled }) {
    console.log(`\n[generateLocal] Sending to Ollama:`);
    console.log(`  Prompt length: ${prompt.length}`);
    console.log(prompt);
    console.log(`  Temperature: ${temperature}, MaxTokens: ${maxTokens}`);
    
    const systemInstruction = this._buildSystemInstruction({ thinkingEnabled, jsonOnly: false });

    const { data } = await axios.post(
      `${this.ollamaUrl}/api/chat`,
      {
        model: this.ollamaModel,
        // Provide a short system message to prevent the model from emitting chain-of-thought
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        stream: false,
        options: {
          temperature,
          top_p: 0.95,
          top_k: 64,
          num_predict: maxTokens
        }
      },
      { timeout: 300000 }
    );

    const raw = this._extractChatResponse(data);
    console.log(`[generateLocal] Ollama returned (length=${raw.length}):`);
    console.log(raw);
    
    const cleaned = this._cleanResponse(raw);
    console.log(`[generateLocal] After cleaning (length=${cleaned.length}):`);
    console.log(`  Result: ${cleaned}`);
    
    return cleaned;
  }

  async generateLocalWithImage({ imageBase64, imageMime, prompt, temperature, maxTokens }) {
    // Construct a multimodal message payload for Ollama. This may vary by Ollama version.
    const imageData = `data:${imageMime};base64,${imageBase64}`;
    const payload = {
      model: this.ollamaModel,
      messages: [
        {
          role: 'user',
          // content as an array mixing image object and text prompt
          content: [
            { type: 'image', data: imageData },
            { type: 'text', text: prompt }
          ]
        }
      ],
      stream: false,
      options: {
        temperature,
        top_p: 0.95,
        top_k: 64,
        num_predict: maxTokens
      }
    };

    const { data } = await axios.post(`${this.ollamaUrl}/api/chat`, payload, { timeout: 300000 });
    return this._extractChatResponse(data);
  }

  async generateLocalRaw({ prompt, temperature, maxTokens }) {
    const data = await this.generateLocalRawResponse({ prompt, temperature, maxTokens });
    return this._extractChatResponse(data);
  }

  async generateLocalRawResponse({ prompt, temperature, maxTokens, thinkingEnabled = this.thinkingEnabled }) {
    const systemInstruction = this._buildSystemInstruction({ thinkingEnabled, jsonOnly: true });
    const { data } = await axios.post(
      `${this.ollamaUrl}/api/chat`,
      {
        model: this.ollamaModel,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt }
        ],
        stream: false,
        options: {
          temperature,
          top_p: 0.95,
          top_k: 64,
          num_predict: maxTokens
        }
      },
      { timeout: 600000 }
    );

    return data;
  }

  async generateLocalRawWithRetry({ prompt, temperature = 0.1, maxTokens = 400, attempts = 3, initialDelay = 2000 }) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.generateLocalRaw({ prompt, temperature, maxTokens });
        return res;
      } catch (err) {
        lastErr = err;
        const delay = initialDelay * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr || new Error('generateLocalRawWithRetry failed');
  }

  _extractChatResponse(data) {
    // Prefer explicit assistant content when available
    const content = data?.message?.content;
    if (content && String(content).trim()) return String(content).trim();

    // If content is empty, try to extract a concise answer from 'thinking'
    let thinking = data?.message?.thinking || data?.response || '';
    thinking = String(thinking || '').trim();
    if (!thinking) return '';

    // Remove explicit chain-of-thought prefaces
    thinking = thinking.replace(/^Here's a thinking process[\s\S]*?suggested explanation of[^:\n]*[:\n]?/i, '');
    thinking = thinking.replace(/^Thinking[\.\.\s\S]*?\n+/i, '');

    // Take first paragraph (up to a double newline)
    const firstPara = thinking.split(/\n\s*\n/)[0].trim();

    // Return up to first 3 sentences to avoid verbose chain-of-thought
    const sentenceMatch = firstPara.match(/[^.!?]+[.!?]+/g);
    if (sentenceMatch && sentenceMatch.length > 0) {
      return sentenceMatch.slice(0, 3).join(' ').trim();
    }

    // Fallback: return first paragraph truncated
    return firstPara.slice(0, 2000).trim();
  }

  _cleanResponse(text) {
    if (!text) return '';
    // Remove excessive blank lines
    let t = text.replace(/\n{2,}/g, '\n\n').trim();

    // Remove leading markdown headers for a cleaner demo display
    t = t.replace(/^#{1,6}\s*/gm, '');

    // Collapse multiple spaces
    t = t.replace(/ {2,}/g, ' ');

    // For questions specifically (identified by ending with ?), keep the full first sentence
    if (t.includes('?')) {
      const firstSentence = t.match(/[^.!?]+\?/);
      if (firstSentence) {
        return firstSentence[0].trim();
      }
    }

    // Configurable trimming via environment variables
    const maxSentences = Number(process.env.RESPONSE_MAX_SENTENCES ?? 3);
    const maxChars = Number(process.env.RESPONSE_MAX_CHARS ?? 600);

    // Try to split into sentences and return first N sentences for concise demo output
    const sentenceMatch = t.match(/[^.!?]+[.!?]+/g);
    if (sentenceMatch && sentenceMatch.length > 0) {
      const first = sentenceMatch.slice(0, maxSentences).join(' ').trim();
      if (first.length < t.length) return `${first.trim()} ...`;
      return first.trim();
    }

    // Fallback: limit to configured characters and add ellipsis
    if (t.length > maxChars) {
      return `${t.slice(0, maxChars).trim()} ...`;
    }

    return t;
  }

  async generateCloud({ prompt, temperature, maxTokens }) {
    if (!this.cloudApiKey) {
      throw new Error('Cloud API key is not configured');
    }

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        topP: 0.95,
        topK: 64
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.cloudModel}:generateContent?key=${this.cloudApiKey}`;
    const { data } = await axios.post(url, payload, { timeout: 300000 });
    return data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') || '';
  }
}

module.exports = new ModelManager();