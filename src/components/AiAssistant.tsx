import React, { useState, useEffect, useRef } from 'react';
import Markdown from 'markdown-to-jsx';
import { getLocalOllamaModel, generateOllama, generateWebLLM, ChatMessage } from '../lib/aiEngine';

interface AiAssistantProps {
  initialCommand: string;
  onClose: () => void;
  onInject: (newCommand: string) => void;
}

export const AiAssistant: React.FC<AiAssistantProps> = ({ initialCommand, onClose, onInject }) => {
   const [ollamaModel, setOllamaModel] = useState<string | null>(null);
   const [mode, setMode] = useState<'ask'|'ollama'|'webllm'>('ask');
   
   const [status, setStatus] = useState<'idle'|'downloading'|'streaming'|'complete'|'error'>('complete'); // defaults to complete so we can chat natively
   const [progressText, setProgressText] = useState<string>('');
   
   const [history, setHistory] = useState<ChatMessage[]>([]);
   const [input, setInput] = useState<string>('');
   
   const scrollRef = useRef<HTMLDivElement>(null);

   // Boot sequences
   useEffect(() => {
     getLocalOllamaModel().then(model => setOllamaModel(model));
     const savedMode = localStorage.getItem('ai_engine_preference');
     if (savedMode && ['ollama', 'webllm'].includes(savedMode)) {
         setMode(savedMode as any);
     }
   }, []);

   // Auto-pin scrolling when AI speaks
   useEffect(() => {
     if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
   }, [history]);

   const handleGenerate = async (query: string) => {
      if (!query.trim() || status === 'downloading' || status === 'streaming') return;
      
      const newHistory = [...history, { role: "user" as const, content: query }];
      setHistory(newHistory);
      setInput('');
      setStatus('streaming');

      // Temporarily inject an empty assistant message we will mutate physically
      setHistory([...newHistory, { role: 'assistant', content: '' }]);

      const streamCallback = (text: string) => {
         setHistory(prev => {
            const temp = [...prev];
            temp[temp.length - 1].content = text;
            return temp;
         });
      };

      try {
         if (mode === 'webllm') {
            setStatus('downloading');
            await generateWebLLM(newHistory, p => setProgressText(p.text), text => {
               setStatus('streaming');
               streamCallback(text);
            });
         } else if (mode === 'ollama' && ollamaModel) {
            await generateOllama(newHistory, ollamaModel, streamCallback);
         }
         setStatus('complete');
      } catch (e: any) {
         setStatus('error');
         setProgressText(`AI Engine Failed: ${e.message}`);
      }
   };

   // Initial Layout Logic
   if (mode === 'ask') {
      return (
         <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', backgroundColor: 'var(--bg-primary)' }}>
            <h2 style={{ color: 'var(--text-primary)' }}>✨ Connect Your AI</h2>
            <p style={{ color: 'var(--text-secondary)' }}>You don't have a default engine selected. Please open the Global Settings (⚙️) from the main menu to select an engine!</p>
            <button onClick={onClose} style={{ alignSelf: 'flex-start', marginTop: '1rem', backgroundColor: 'var(--accent-purple)' }}>Understood</button>
         </div>
      );
   }

   // Interception mapping allowing explicit code injection buttons to spawn natively over markdown!
   const CodeRenderer = ({ children, className }: any) => {
       const isInline = !className;
       const codeStr = String(children);
       if (isInline || !codeStr.includes('ffmpeg')) return <code style={{ backgroundColor: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: '4px' }}>{children}</code>;
       
       return (
          <div style={{ margin: '1rem 0', position: 'relative' }}>
             <pre style={{ backgroundColor: 'var(--bg-tertiary)', padding: '1rem', borderRadius: '8px', overflowX: 'auto', border: '1px solid var(--border-focus)' }}>
                 <code>{codeStr}</code>
             </pre>
             <button onClick={() => onInject(codeStr.trim())} style={{ position: 'absolute', top: '10px', right: '10px', backgroundColor: 'var(--accent-purple)', fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>↙ Inject into App</button>
          </div>
       );
   };

   return (
      <div style={{ padding: '0', display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', backgroundColor: 'var(--bg-primary)' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 2rem', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <h2 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.2rem' }}>✨ AI Assistant <span style={{ fontSize: '0.7rem', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', opacity: 0.7 }}>{mode.toUpperCase()}</span></h2>
            </div>
            <button onClick={onClose} style={{ backgroundColor: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>Close</button>
         </div>

         <div style={{ padding: '1rem 2rem', backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-secondary)'}}>Context: </span>
            <code style={{ color: 'var(--accent-green)'}}>{initialCommand || 'Empty Command Workspace'}</code>
         </div>

         <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {history.length === 0 && (
               <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-secondary)' }}>
                  <p style={{ fontSize: '1.2rem', marginBottom: '2rem' }}>How can I orchestrate your workflow today?</p>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                     <button onClick={() => handleGenerate(`Explain exactly what this command does:\n${initialCommand}`)} style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-focus)' }}>Dissect Command</button>
                     <button onClick={() => handleGenerate(`Rewrite this command to map hardware acceleration (NVENC/QuickSync) if possible:\n${initialCommand}`)} style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-focus)' }}>Optimize Hardware</button>
                     <button onClick={() => handleGenerate(`I want to crush the file size of this command heavily for web streaming. Rewrite it:\n${initialCommand}`)} style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-focus)' }}>Squash For Web</button>
                  </div>
               </div>
            )}

            {history.map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                   <div style={{ maxWidth: '85%', padding: '1rem', borderRadius: '12px', backgroundColor: msg.role === 'user' ? 'var(--accent-purple)' : 'transparent', color: 'var(--text-primary)', border: msg.role === 'user' ? 'none' : '1px solid var(--border-subtle)', lineHeight: 1.6 }}>
                      {msg.role === 'user' ? (
                         <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      ) : (
                         <Markdown options={{ overrides: { code: CodeRenderer } }}>{msg.content}</Markdown>
                      )}
                   </div>
                </div>
            ))}
            
            {status === 'downloading' && (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                   <span style={{ color: 'var(--accent-purple)', animation: 'pulse 1s infinite' }}>Downloading Native Weights...</span> {progressText}
                </div>
            )}
            {status === 'streaming' && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Hallucinating natively...</div>}
            {status === 'error' && <div style={{ color: 'var(--accent-red)' }}>{progressText}</div>}
         </div>

         <div style={{ padding: '1.5rem 2rem', backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
             <div style={{ display: 'flex', gap: '1rem' }}>
                <input 
                   type="text" 
                   value={input} 
                   onChange={e => setInput(e.target.value)} 
                   onKeyDown={e => e.key === 'Enter' && handleGenerate(input + `\nContext Range: ${initialCommand}`)}
                   placeholder="Type a request..." 
                   style={{ flex: 1, padding: '1rem', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-focus)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '1rem' }}
                />
                <button onClick={() => handleGenerate(input + `\nContext Range: ${initialCommand}`)} disabled={status === 'streaming'} style={{ backgroundColor: 'var(--accent-green)', padding: '0 2rem' }}>Send</button>
             </div>
         </div>
         <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }`}</style>
      </div>
   );
}
