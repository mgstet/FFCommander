import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';

interface SettingsModalProps {
   onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
   const [aiEngine, setAiEngine] = useState<string>('ask');
   const [appVersion, setAppVersion] = useState<string>('');
   const [ffmpegVersion, setFfmpegVersion] = useState<string>('');

   // Hydrate natively from localStorage
   useEffect(() => {
      const stored = localStorage.getItem('ai_engine_preference');
      if (stored) {
         setAiEngine(stored);
      }
      getVersion().then(v => setAppVersion(v)).catch(() => {});
      invoke<string>('get_ffmpeg_version').then(v => setFfmpegVersion(v)).catch(() => {});
   }, []);

   const saveEngine = (engine: string) => {
      setAiEngine(engine);
      localStorage.setItem('ai_engine_preference', engine);
   };

   return (
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
         <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-subtle)', width: '500px', maxWidth: '90%' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
               <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>⚙️ Global Settings</h2>
               <button onClick={onClose} style={{ backgroundColor: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ marginBottom: '2rem' }}>
               <h3 style={{ color: 'var(--text-primary)', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>AI Assistant Engine</h3>
               <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Choose exactly which offline rendering framework the AI Assistant should boot natively.</p>

               <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', backgroundColor: aiEngine === 'ask' ? 'var(--bg-tertiary)' : 'transparent', border: '1px solid', borderColor: aiEngine === 'ask' ? 'var(--border-focus)' : 'var(--border-subtle)', borderRadius: '8px', cursor: 'pointer' }}>
                     <input type="radio" value="ask" checked={aiEngine === 'ask'} onChange={() => saveEngine('ask')} />
                     <div>
                        <b style={{ color: 'var(--text-primary)'}}>Always Ask Me</b>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Prompt immediately upon launching the Assistant modal.</p>
                     </div>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', backgroundColor: aiEngine === 'ollama' ? 'var(--bg-tertiary)' : 'transparent', border: '1px solid', borderColor: aiEngine === 'ollama' ? 'var(--accent-blue)' : 'var(--border-subtle)', borderRadius: '8px', cursor: 'pointer' }}>
                     <input type="radio" value="ollama" checked={aiEngine === 'ollama'} onChange={() => saveEngine('ollama')} />
                     <div>
                        <b style={{ color: 'var(--accent-blue)'}}>Local Ollama Engine</b>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Force the assistant to silently map logic to localhost:11434 instantly.</p>
                     </div>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', backgroundColor: aiEngine === 'webllm' ? 'var(--bg-tertiary)' : 'transparent', border: '1px solid', borderColor: aiEngine === 'webllm' ? 'var(--accent-purple)' : 'var(--border-subtle)', borderRadius: '8px', cursor: 'pointer' }}>
                     <input type="radio" value="webllm" checked={aiEngine === 'webllm'} onChange={() => saveEngine('webllm')} />
                     <div>
                        <b style={{ color: 'var(--accent-purple)'}}>Native GPU (WebLLM)</b>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)'}}>Download models organically and push data natively across your dedicated Graphics card.</p>
                     </div>
                  </label>
               </div>
            </div>

            <div style={{ marginBottom: '2rem' }}>
               <h3 style={{ color: 'var(--text-primary)', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>About FFCommander</h3>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <div><b>App Version:</b> {appVersion || 'Loading...'}</div>
                  <div><b>FFmpeg Backend:</b> {ffmpegVersion || 'Loading...'}</div>
               </div>
            </div>

            <div style={{ textAlign: 'right' }}>
               <button onClick={onClose} style={{ backgroundColor: 'var(--accent-purple)', color: 'white' }}>Done</button>
            </div>

         </div>
      </div>
   );
}
