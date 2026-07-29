import { invoke } from '@tauri-apps/api/core';

export interface OllamaStatus {
  online: boolean;
  active_model: string;
  models: string[];
}

export async function computeHash(str: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    // Fallback for environments without crypto.subtle
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }
}

export async function fetchOllamaStatus(): Promise<OllamaStatus> {
  try {
    if (window.__TAURI_INTERNALS__) {
      const status = await invoke<OllamaStatus>('check_ollama_status');
      if (status.online) {
        return status;
      }
    }
    
    const res = await fetch('http://localhost:11434/api/tags', { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      const models = data.models?.map((m: any) => m.name) || ['llama3.2:3b'];
      const defaultModel = models.find((m: string) => m.includes('qwen2.5-coder')) || models[0] || 'llama3.2:3b';
      return { online: true, active_model: defaultModel, models };
    }
  } catch (err) {
    console.warn('Ollama status check notice:', err);
  }

  return { online: false, active_model: 'llama3.2:3b', models: ['llama3.2:3b', 'qwen2.5-coder:1.5b'] };
}

// Sub-150ms Real-Time Token Streaming via SSE
export async function streamOllamaAssistantTokens(
  prompt: string,
  systemContext: string = '',
  model: string = 'llama3.2:3b',
  onToken: (token: string) => void
): Promise<string> {
  let fullText = '';

  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3.2:3b',
        prompt,
        system: systemContext,
        stream: true,
      }),
    });

    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.response) {
              fullText += parsed.response;
              onToken(parsed.response);
            }
          } catch (_) {}
        }
      }

      if (fullText.trim().length > 5) {
        return fullText;
      }
    }
  } catch (err) {
    console.warn('[Ollama Stream] Direct HTTP SSE stream notice:', err);
  }

  // Fallback if HTTP stream was interrupted
  const fallbackText = await askOllamaAssistant(prompt, systemContext, model);
  onToken(fallbackText);
  return fallbackText;
}

export async function askOllamaAssistant(
  prompt: string, 
  systemContext: string = '', 
  model: string = 'llama3.2:3b'
): Promise<string> {
  if (window.__TAURI_INTERNALS__) {
    try {
      const result = await invoke<string>('query_ollama', {
        model: model || 'llama3.2:3b',
        prompt,
        systemContext: systemContext || undefined,
      });
      if (result && result.trim().length > 5) {
        return result;
      }
    } catch (rustErr) {
      console.warn('[Ollama] Rust IPC notice, trying direct HTTP fetch:', rustErr);
    }
  }

  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3.2:3b',
        prompt,
        system: systemContext,
        stream: false,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.response && data.response.trim().length > 5) {
        return data.response;
      }
    }
  } catch (fetchErr) {
    console.warn('[Ollama] Direct HTTP fetch notice:', fetchErr);
  }

  return '⚠️ **Ollama is offline.** Please start Ollama (`ollama serve`) to get AI-generated solutions. No local LLM connection available.';
}
