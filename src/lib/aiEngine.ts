import { CreateMLCEngine, MLCEngine, InitProgressReport } from "@mlc-ai/web-llm";

// The strict System Prompt we hide from the user shaping its charismatic persona
export const SYSTEM_PROMPT = `You are a charismatic, elite FFmpeg Senior Engineer acting as a mentor.
RULES:
1. Speak confidently and naturally using bolding and concise analogies.
2. NEVER use robotic filler phrases like 'Here is the breakdown:' or 'Sure, I can help'.
3. If dissecting a command, break down the flags intelligently without sounding like an AI textbook.
4. If asked to generate a new command, provide the final FFmpeg string inside a single markdown code block (\`\`\`bash\\n...\\n\`\`\`).
5. Be incredibly concise. Let your FFmpeg expertise shine.`;

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }

// MLCEngine instance singleton so we don't redownload or reload VRAM on repeating invocations
let engineCache: MLCEngine | null = null;

export type UpdateCallback = (text: string) => void;
export type ProgressCallback = (progress: InitProgressReport) => void;

// Wires up Native GPU WebGL/WebGPU acceleration via Phi-3 natively
export async function generateWebLLM(
  history: ChatMessage[], 
  onProgress: ProgressCallback,
  onStream: UpdateCallback
) {
  if (!engineCache) {
    // 1.9GB model, highly optimized for logic and CLI interpretation
    const selectedModel = "Phi-3-mini-4k-instruct-q4f16_1-MLC";
    
    engineCache = await CreateMLCEngine(selectedModel, {
      initProgressCallback: onProgress,
    });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
  ];

  const chunks = await engineCache.chat.completions.create({
    messages,
    stream: true,
  });

  let fullResponse = "";
  for await (const chunk of chunks) {
    const nextToken = chunk.choices[0]?.delta.content || "";
    fullResponse += nextToken;
    onStream(fullResponse);
  }
}

// Probes explicitly for an Ollama backend and grabs whatever model they have pulled locally
export async function getLocalOllamaModel(): Promise<string | null> {
    try {
        const res = await fetch('http://localhost:11434/api/tags');
        if (!res.ok) return null;
        const data = await res.json();
        // Just blindly pluck the topmost installed model
        if (data.models && data.models.length > 0) {
            return data.models[0].name; 
        }
        return null;
    } catch(e) {
        return null;
    }
}

// Streams purely via HTTP strictly enforcing JSON mapping
export async function generateOllama(
  history: ChatMessage[],
  modelName: string,
  onStream: UpdateCallback
) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
  ];

  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      messages,
      stream: true
    })
  });

  if (!response.body) throw new Error("No response body from Ollama");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Safely extract complete lines preventing shattered TCP JSON fragment errors
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        
        if (!line) continue;
        
        try {
           const parsed = JSON.parse(line);
           if (parsed.message?.content) {
              fullResponse += parsed.message.content;
              onStream(fullResponse);
           }
        } catch (e) {
           // Safely ignore truly corrupted artifacts traversing the bounds
        }
    }
  }
}
