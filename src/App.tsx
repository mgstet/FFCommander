import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { CommandBlock, parseFfmpegCommand, serializeFfmpegCommand } from "./lib/ffmpegParser";
import "./App.css";

interface ProgressPayload { job_id: string; line: string; }
interface FfprobeData {
  format?: { filename: string; duration: string; size: string; bit_rate: string; };
  streams?: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; sample_rate?: string; sample_aspect_ratio?: string; field_order?: string; bit_rate?: string; bits_per_raw_sample?: string; bits_per_sample?: string; }>;
}
interface Preset { id: string; name: string; description: string; command: string; }
interface Job {
  id: string; rawCommand: string; args: string[]; status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: string; percent: number; duration: number;
}

function App() {
  const [ffmpegStatus, setFfmpegStatus] = useState<string>("Checking...");
  const [rawCommand, setRawCommand] = useState<string>("-i click_to_set_input.mp4 -c:v libx264 -crf 23 -c:a aac -b:a 192k click_to_set_output.mp4");
  const [blocks, setBlocks] = useState<CommandBlock[]>(parseFfmpegCommand("-i click_to_set_input.mp4 -c:v libx264 -crf 23 -c:a aac -b:a 192k click_to_set_output.mp4"));
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const blocksRef = useRef(blocks);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  
  // Job Queue State
  const [jobQueue, setJobQueue] = useState<Job[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState<boolean>(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [showConsole, setShowConsole] = useState<boolean>(false);
  const [mediaInfos, setMediaInfos] = useState<Record<string, FfprobeData | 'loading' | 'error'>>({});
  const [ghostProbeMap, setGhostProbeMap] = useState<Record<string, string>>({}); // Maps `%04d` paths back to strict file names for probing UI

  // Drag & Drop State
  const [draggedOverId, setDraggedOverId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null); 

  // Batch Mode State
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);
  const [batchFiles, setBatchFiles] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState<'original' | 'destination'>('original');
  const [batchSuffix, setBatchSuffix] = useState('_encoded');
  const [batchDestFolder, setBatchDestFolder] = useState('');

  // Presets State
  const [presets, setPresets] = useState<Preset[]>(() => {
    const saved = localStorage.getItem('ffcommander_presets');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [showPresetManager, setShowPresetManager] = useState<boolean>(false);
  const [presetFocusId, setPresetFocusId] = useState<string | null>(null);
  const [presetDraft, setPresetDraft] = useState<Partial<Preset>>({});

  useEffect(() => { localStorage.setItem('ffcommander_presets', JSON.stringify(presets)); }, [presets]);

  const processInputSequenceInjection = (absolutePath: string, targetBlockId: string) => {
      const match = absolutePath.match(/^(.*?)(\d+)(\.[a-z]+)$/i);
      let outPath = absolutePath;
      let startNumber = '';
      
      const imageExts = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.dpx', '.exr'];
      let injectedBlocks = blocksRef.current;
      
      if (match) {
          const ext = match[3].toLowerCase();
          if (imageExts.includes(ext)) {
              const prefix = match[1];
              const digits = match[2];
              
              startNumber = parseInt(digits, 10).toString();
              const isZeroPadded = digits.startsWith('0') || digits.length > 1;
              const formatString = isZeroPadded ? `%0${digits.length}d` : `%d`;
              outPath = `${prefix}${formatString}${match[3]}`;
              
              const targetIdx = injectedBlocks.findIndex(b => b.id === targetBlockId);
              if (targetIdx !== -1) {
                  // If we don't already have `-start_number` prior, inject it!
                  const priorBlock = targetIdx > 0 ? injectedBlocks[targetIdx - 1] : null;
                  if (!priorBlock || priorBlock.flag !== '-start_number') {
                      const startNumberBlock: CommandBlock = {
                          id: "blk_" + Math.random().toString(36).substring(2, 9),
                          type: 'input', flag: '-start_number', value: startNumber
                      };
                      injectedBlocks = [
                          ...injectedBlocks.slice(0, targetIdx),
                          startNumberBlock,
                          ...injectedBlocks.slice(targetIdx)
                      ];
                  } else if (priorBlock && priorBlock.flag === '-start_number') {
                      injectedBlocks[targetIdx - 1] = { ...priorBlock, value: startNumber };
                  }
              }
              // Store Ghost Map bridging %04d string directly back to exact native file path for FFprobe!
              setGhostProbeMap(prev => ({ ...prev, [outPath]: absolutePath }));
          }
      }

      // Find our primary target (it might have shifted if we spliced, we just map by id)
      injectedBlocks = injectedBlocks.map(b => b.id === targetBlockId ? { ...b, value: outPath } : b);
      syncBlocks(injectedBlocks);
  };


  useEffect(() => {
    async function checkFfmpeg() {
      try { const isInstalled = await invoke<boolean>("check_ffmpeg_path"); setFfmpegStatus(isInstalled ? "FFmpeg Ready" : "FFmpeg Not Found"); } 
      catch (err) { console.warn("Could not reach native backend: " + err); }
    }
    checkFfmpeg();

    const unlistenDragDrop = getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === 'drop') {
            if (draggedIdRef.current && e.payload.paths && e.payload.paths.length > 0) {
                const path = e.payload.paths[0];
                const blockId = draggedIdRef.current;
                
                // Route image sequences or plain videos
                const targetBlock = blocksRef.current.find(b => b.id === blockId);
                if (targetBlock && targetBlock.flag === '-i') {
                    processInputSequenceInjection(path, blockId);
                } else {
                    const newBlocks = blocksRef.current.map(b => b.id === blockId ? { ...b, value: path } : b);
                    syncBlocks(newBlocks);
                }
            }
            draggedIdRef.current = null;
            setDraggedOverId(null);
        } else if (e.payload.type === 'leave') {
            draggedIdRef.current = null;
            setDraggedOverId(null);
        }
    });

    const unlistens = [
       listen<ProgressPayload>("ffmpeg-started", (e) => { 
           setJobQueue(prev => prev.map(j => j.id === e.payload.job_id ? { ...j, status: 'processing', progress: '0%' } : j));
           setConsoleLogs(prev => [...prev.slice(-49), `[${e.payload.job_id}] Started...`]);
       }),
       listen<ProgressPayload>("ffmpeg-progress", (e) => {
           setConsoleLogs(prev => [...prev.slice(-49), e.payload.line]);
           if (e.payload.line.includes("time=")) {
               const match = e.payload.line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
               if (match) {
                   const currentSecs = parseFloat(match[1]) * 3600 + parseFloat(match[2]) * 60 + parseFloat(match[3]);
                   setJobQueue(prev => prev.map(j => {
                       if (j.id === e.payload.job_id) {
                           if (j.duration && j.duration > 0) {
                               const pct = Math.min(100, Math.max(0, (currentSecs / j.duration) * 100));
                               return { ...j, percent: pct, progress: `${pct.toFixed(1)}%` };
                           } else { return { ...j, progress: `Processed ${currentSecs.toFixed(1)}s` }; }
                       }
                       return j;
                   }));
               }
           }
       }),
       listen<ProgressPayload>("ffmpeg-complete", (e) => {
           const finalStatus = e.payload.line.includes("Killed") ? 'cancelled' : (e.payload.line.includes("status: 0") ? 'completed' : 'failed');
           setJobQueue(prev => prev.map(j => j.id === e.payload.job_id ? { ...j, status: finalStatus, progress: e.payload.line, percent: finalStatus === 'completed' ? 100 : 0 } : j));
           setConsoleLogs(prev => [...prev.slice(-49), `[${e.payload.job_id}] ${e.payload.line}`]);
       })
    ];
    
    return () => { 
        unlistenDragDrop.then(f => f());
        unlistens.forEach(p => p.then(f => f())); 
    };
  }, []);

  const addConsoleLog = (line: string) => setConsoleLogs(prev => [...prev.slice(-49), line]);
  const updateJob = (id: string, updates: Partial<Job>) => setJobQueue(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j));

  useEffect(() => {
     if (!isProcessingQueue) return;
     const nextJob = jobQueue.find(j => j.status === 'pending');
     const runningJob = jobQueue.find(j => j.status === 'processing');
     
     if (!nextJob && !runningJob) setIsProcessingQueue(false);
     else if (nextJob && !runningJob) {
        invoke("enqueue_job", { jobId: nextJob.id, args: nextJob.args }).catch(err => {
           updateJob(nextJob.id, { status: 'failed', progress: String(err) });
           addConsoleLog(`[${nextJob.id}] Spawn Failed: ` + err);
        });
     }
  }, [jobQueue, isProcessingQueue]);

  useEffect(() => {
     const inputPaths = blocks.filter(b => b.flag === '-i' && b.value).map(b => b.value);
     inputPaths.forEach(path => {
         const probePath = ghostProbeMap[path] || path;
         if (!mediaInfos[path] && path !== 'click_to_set_input.mp4') {
             setMediaInfos(prev => ({...prev, [path]: 'loading'}));
             invoke<string>('probe_file', { path: probePath }).then(res => setMediaInfos(prev => ({...prev, [path]: JSON.parse(res)})))
             .catch(() => setMediaInfos(prev => ({...prev, [path]: 'error'})));
         }
     });
  }, [blocks, ghostProbeMap]);

  const syncBlocks = (newBlocks: CommandBlock[]) => { setBlocks(newBlocks); setRawCommand(serializeFfmpegCommand(newBlocks)); };
  const handleRawChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => { setRawCommand(e.target.value); setBlocks(parseFfmpegCommand(e.target.value)); setSelectedBlockId(null); };

  const handleInteractiveBlockClick = async (block: CommandBlock) => {
     if (block.flag === '-i') {
         try {
             const selected = await open({ filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wav', 'mp3', 'png', 'jpg', 'jpeg', 'tif', 'dpx', 'exr'] }] });
             if (typeof selected === 'string') {
                 processInputSequenceInjection(selected, block.id);
             }
         } catch(e) { addConsoleLog("Dialog Error:" + e); }
     } else if (block.type === 'output' && !block.flag) {
         try {
             const saved = await save({ filters: [{ name: 'Video Export', extensions: ['mp4', 'mov', 'mkv', 'webm'] }] });
             if (typeof saved === 'string') {
                 syncBlocks(blocks.map(b => b.id === block.id ? { ...b, value: saved } : b));
             }
         } catch(e) { addConsoleLog("Dialog Error:" + e); }
     } else {
         setSelectedBlockId(block.id);
     }
  };

  const getJobDuration = (inputArgs: string[]) => {
     const iFlagIdx = inputArgs.indexOf('-i');
     if (iFlagIdx !== -1 && iFlagIdx + 1 < inputArgs.length) {
         const path = inputArgs[iFlagIdx + 1];
         const info = mediaInfos[path];
         if (info && info !== 'loading' && info !== 'error' && info.format?.duration) {
             return parseFloat(info.format.duration);
         }
     }
     return 0; 
  };

  const handlePushToQueue = () => {
    const args = blocks.flatMap(b => {
       const res = [];
       if (b.flag) res.push(b.flag);
       if (b.value) res.push(b.value);
       return res;
    });
    setJobQueue(prev => [...prev, { id: "job_" + Math.random().toString(36).substring(2, 9), rawCommand, args, status: 'pending', progress: 'Waiting...', percent: 0, duration: getJobDuration(args) }]);
  };

  const handleRemoveJob = async (id: string, status: string) => {
     if (status === 'processing') { try { await invoke("cancel_job", { jobId: id }); } catch (e) { addConsoleLog(`Failed to kill job ${id} `); } } 
     else { setJobQueue(prev => prev.filter(j => j.id !== id)); }
  };
  const handleClearCompleted = () => setJobQueue(prev => prev.filter(j => j.status === 'pending' || j.status === 'processing'));
  const toggleProcessing = () => {
     if (isProcessingQueue) {
         setIsProcessingQueue(false);
         const activeJob = jobQueue.find(j => j.status === 'processing');
         if (activeJob) invoke("cancel_job", { jobId: activeJob.id }).catch(() => {});
     } else { setIsProcessingQueue(true); }
  };

  const handleSelectBatch = async () => {
    try {
      const selected = await open({ multiple: true, filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wav', 'mp3', 'png', 'jpg', 'jpeg', 'tif', 'dpx'] }] });
      if (Array.isArray(selected) && selected.length > 0) { setBatchFiles(selected); setShowBatchModal(true); }
      else if (typeof selected === 'string') { setBatchFiles([selected]); setShowBatchModal(true); }
    } catch (e) { addConsoleLog("Batch Picker Error: " + e); }
  };

  const handlePickBatchDest = async () => {
      try { const folder = await open({ directory: true }); if (typeof folder === 'string') setBatchDestFolder(folder); } 
      catch (e) { addConsoleLog("Dialog Error:" + e); }
  };

  const finalizeBatchJobs = () => {
    const newJobs: Job[] = [];
    batchFiles.forEach(inputPath => {
       const isWin = inputPath.includes('\\');
       const sep = isWin ? '\\' : '/';
       const lastSlash = inputPath.lastIndexOf(sep);
       const directory = lastSlash === -1 ? '' : inputPath.substring(0, lastSlash);
       const filenameWithExt = lastSlash === -1 ? inputPath : inputPath.substring(lastSlash + 1);
       const lastDot = filenameWithExt.lastIndexOf('.');
       const filename = lastDot === -1 ? filenameWithExt : filenameWithExt.substring(0, lastDot);
       const ext = lastDot === -1 ? '' : filenameWithExt.substring(lastDot);

       const destDir = batchMode === 'destination' && batchDestFolder ? batchDestFolder : directory;
       let finalOutPath = `${destDir}${destDir.endsWith(sep) ? '' : sep}${filename}${batchSuffix}${ext}`;
       if (finalOutPath === inputPath) finalOutPath = `${destDir}${destDir.endsWith(sep) ? '' : sep}${filename}${batchSuffix}_copy${ext}`;

       const args = blocks.flatMap(b => {
          const res = [];
          if (b.flag && b.flag !== '-i') res.push(b.flag);
          if (b.flag === '-i') { res.push('-i', inputPath); }
          else if (b.type === 'output' && !b.flag) { res.push(finalOutPath); }
          else if (b.value) { res.push(b.value); }
          return res;
       });
       newJobs.push({ id: "batch_" + Math.random().toString(36).substring(2, 9), rawCommand: args.join(' '), args, status: 'pending', progress: 'Waiting...', percent: 0, duration: getJobDuration(args) });
    });
    setJobQueue(prev => [...prev, ...newJobs]);
    setShowBatchModal(false);
  };

  // ----- QoL formatting -----
  const parseFps = (str?: string) => {
      if (!str) return 0;
      const parts = str.split('/');
      return parts.length === 2 ? parseFloat(parts[0]) / parseFloat(parts[1]) : parseFloat(str);
  };
  const formatTimecode = (rawSecs: string | undefined, fps: number) => {
      if (!rawSecs) return 'N/A';
      const secs = parseFloat(rawSecs);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const f = fps > 0 ? Math.floor((secs % 1) * fps) : 0;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  };
  const formatBitrate = (rawBps: string | undefined) => {
      if (!rawBps) return 'N/A';
      const bps = parseFloat(rawBps);
      if (bps > 1000000) return `${(bps / 1000000).toFixed(1)} Mbps`;
      return `${(bps / 1000).toFixed(0)} kbps`;
  };

  const selectedBlock = blocks.find(b => b.id === selectedBlockId);
  const getBadgeColor = (type: string) => { switch (type) { case 'input': return 'var(--accent-blue)'; case 'video': return 'var(--accent-purple)'; case 'audio': return 'var(--accent-green)'; case 'filter': return 'var(--accent-red)'; case 'output': return 'var(--accent-green)'; default: return 'var(--border-focus)'; } };

  return (
    <>
      <div className="top-bar">
         <h1>FFCommander</h1>
         <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select value={selectedPresetId} onChange={(e) => { const p = presets.find(x => x.id === e.target.value); if (p) { setRawCommand(p.command); setBlocks(parseFfmpegCommand(p.command)); setSelectedPresetId(p.id); } }} style={{ padding: '0.5rem', backgroundColor: 'var(--bg-secondary)', color: 'white', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
               <option value="">-- Quick Load Preset --</option>
               {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={() => setShowPresetManager(true)} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-focus)', color: 'var(--text-primary)' }}>⚙ Manage Presets...</button>
         </div>
      </div>

      <div className="main-scroll-area">
        <section>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>1. The Command Dissector</h2>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button onClick={handleSelectBatch} style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', backgroundColor: 'var(--accent-blue)' }}>+ Add Batch to Queue...</button>
                <button onClick={handlePushToQueue} style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}>+ Add Single Job</button>
              </div>
           </div>
           <div className="dissector-container">
             <div>
                 <div className="raw-input-wrapper"><textarea value={rawCommand} onChange={handleRawChange} placeholder="Paste raw FFmpeg command here..." /></div>
                 <div className="visual-blocks">
                   {blocks.map((b) => (
                     <div 
                       key={b.id} 
                       className={`block-item ${selectedBlockId === b.id ? 'active' : ''}`} 
                       style={{ borderLeft: `4px solid ${getBadgeColor(b.type)}`, borderColor: selectedBlockId === b.id || draggedOverId === b.id ? 'var(--accent-purple)' : undefined, backgroundColor: draggedOverId === b.id ? 'var(--border-subtle)' : undefined }} 
                       onClick={() => handleInteractiveBlockClick(b)}
                       onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (b.flag === '-i') { setDraggedOverId(b.id); draggedIdRef.current = b.id; } }}
                       onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
                       onDragLeave={(e) => { 
                           e.preventDefault(); e.stopPropagation(); 
                           setDraggedOverId(null); 
                           setTimeout(() => { draggedIdRef.current = null; }, 100);
                       }}
                     >
                       {b.flag && <span style={{ color: getBadgeColor(b.type), marginRight: '6px', pointerEvents: 'none' }}>{b.flag}</span>}
                       {b.value && <span style={{ pointerEvents: 'none' }}>{b.value}</span>}
                     </div>
                   ))}
                 </div>
             </div>
             <div className="properties-panel">
               <h3>Block Properties</h3>
               {selectedBlock ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                     <div><label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Flag</label><input type="text" value={selectedBlock.flag} onChange={(e) => syncBlocks(blocks.map(b => b.id === selectedBlock.id ? { ...b, flag: e.target.value } : b))} /></div>
                     <div><label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Value</label><input type="text" value={selectedBlock.value} onChange={(e) => syncBlocks(blocks.map(b => b.id === selectedBlock.id ? { ...b, value: e.target.value } : b))} /></div>
                  </div>
               ) : (<p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Select a flag block iteratively edit it.</p>)}
               <p style={{ color: 'var(--accent-green)', fontSize: '0.8rem', marginTop: '2rem' }}>💡 Tip: <b>Drag & Drop</b> a sequence or video directly onto an <b>-i</b> block to effortlessly map absolute Paths!</p>
             </div>
           </div>
        </section>

        <section>
            <h2>2. Input Diagnostics</h2>
            <div className="multi-inspector">
               {blocks.filter(b => b.flag === '-i' && b.value).map(b => {
                   const info = mediaInfos[b.value] || 'loading';
                   if (info === 'loading') return <div key={b.value} className="properties-panel" style={{ padding: '1rem' }}><p>Probing {b.value.split(/[/\\]/).pop()}...</p></div>;
                   if (info === 'error') return <div key={b.value} className="properties-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--accent-red)' }}><p>Failed to probe: {b.value}</p></div>;
                   const vStream = info.streams?.find(s => s.codec_type === 'video');
                   const aStream = info.streams?.find(s => s.codec_type === 'audio');
                   const fps = parseFps(vStream?.r_frame_rate);
                   const isInterlaced = vStream?.field_order && vStream.field_order !== 'progressive' && vStream.field_order !== 'unknown';
                   return (
                      <div key={b.value} className="properties-panel" style={{ padding: '1rem', borderLeft: '4px solid var(--accent-blue)', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                         <h3 style={{ width: '100%', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>{b.value.split(/[/\\]/).pop()} {ghostProbeMap[b.value] ? <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)', marginLeft: '1rem' }}>(Sequence Detected)</span> : '' }</h3>
                         
                         <div style={{ display: 'inline-flex', gap: '0.5rem', width: '100%', alignItems: 'center' }}>
                           <span style={{ fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-primary)', marginRight: '0.5rem' }}>{vStream ? `${vStream.width}x${vStream.height}` : 'N/A Resolution'}</span>
                           <span style={{ fontSize: '0.75rem', backgroundColor: isInterlaced ? 'var(--accent-red)' : 'var(--accent-green)', padding: '2px 6px', borderRadius: '4px', color:'white' }}>{isInterlaced ? 'INTERLACED' : 'PROGRESSIVE'}</span>
                           {vStream?.sample_aspect_ratio && <span style={{ fontSize: '0.75rem', backgroundColor: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', color:'var(--text-secondary)' }}>PAR {vStream.sample_aspect_ratio}</span>}
                         </div>

                         <div style={{ display: 'inline-flex', flexDirection: 'column' }}> 
                            <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)'}}>Video Codec</span> 
                            <span>{vStream?.codec_name || 'N/A'}</span>
                            <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)', marginTop: '4px' }}>{vStream?.bit_rate ? formatBitrate(vStream.bit_rate) : formatBitrate(info.format?.bit_rate)}</span>
                            {vStream?.bits_per_raw_sample && <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)' }}>{vStream.bits_per_raw_sample}-bit</span>}
                         </div>

                         <div style={{ display: 'inline-flex', flexDirection: 'column' }}> 
                            <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)'}}>Audio Codec</span> 
                            <span>{aStream?.codec_name || 'N/A'}</span>
                            <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)', marginTop: '4px' }}>{formatBitrate(aStream?.bit_rate)}</span>
                            {aStream?.sample_rate && <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)' }}>{aStream.sample_rate} Hz</span>}
                         </div>

                         <div style={{ display: 'inline-flex', flexDirection: 'column' }}> 
                            <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)'}}>Framerate</span> 
                            <span>{fps > 0 ? fps.toFixed(3) : 'N/A'} fps</span>
                         </div>
                         <div style={{ display: 'inline-flex', flexDirection: 'column' }}> 
                            <span style={{ fontSize:'0.7rem', color:'var(--text-secondary)'}}>Timecode (SMPTE)</span> 
                            <span style={{ fontFamily: 'var(--font-mono)'}}>{formatTimecode(info.format?.duration, fps)}</span>
                         </div>
                      </div>
                   );
               })}
            </div>
        </section>

        <section className="queue-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>3. Job Execution Queue</h2>
                <div style={{ display: 'flex', gap: '1rem' }}>
                   <button onClick={handleClearCompleted} style={{ backgroundColor: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>Clear Completed</button>
                   <button onClick={() => setShowConsole(!showConsole)} style={{ backgroundColor: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{showConsole ? 'Hide Console' : 'Show Console'}</button>
                   <button onClick={toggleProcessing} style={{ backgroundColor: isProcessingQueue ? 'var(--accent-red)' : 'var(--accent-purple)' }} disabled={!isProcessingQueue && jobQueue.filter(j => j.status === 'pending').length === 0}>
                       {isProcessingQueue ? '■ Stop Processing' : '▶ Process Queue'}
                   </button>
                </div>
            </div>
            {showConsole && (
                <div style={{ backgroundColor: '#000', padding: '1rem', marginTop: '1rem', borderRadius: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                   {consoleLogs.length === 0 ? <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>System is idle...</span> : consoleLogs.map((log, i) => <div key={i} style={{ color: '#00FF00', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', wordBreak: 'break-all', marginBottom: '4px' }}>{log}</div>)}
                </div>
            )}
            <div className="queue-list">
                {jobQueue.map(job => (
                   <div key={job.id} className={`queue-item ${job.status}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-primary)' }}>
                          <div><strong>{job.id}</strong> <span style={{ textTransform: 'uppercase', fontSize: '0.8rem', marginLeft: '0.5rem' }}>{job.status}</span></div>
                          <button onClick={() => handleRemoveJob(job.id, job.status)} style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>✕ Drop</button>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{job.rawCommand}</div>
                      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.5rem' }}>
                         <div style={{ flex: 1, height: '4px', background: 'var(--bg-primary)', borderRadius: '2px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${job.percent}%`, background: job.status === 'failed' || job.status === 'cancelled' ? 'var(--accent-red)' : 'var(--accent-purple)', transition: 'width 0.2s linear' }} /></div>
                         <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{job.progress}</div>
                      </div>
                   </div>
                ))}
            </div>
        </section>
      </div>

      <div className="bottom-bar">
         <div>Daemon Status: {ffmpegStatus}</div>
         <div>{jobQueue.length} Jobs Total | {jobQueue.filter(j => j.status === 'completed').length} Finished</div>
      </div>

      {showPresetManager && (
         <div className="modal-overlay">
            <div className="modal-content modal-content-large">
               <div className="preset-sidebar">
                   <h3 style={{ padding: '0.5rem', marginTop: '0.5rem', color: 'white' }}>Preset Vault</h3>
                   <button onClick={() => { setPresetFocusId(null); setPresetDraft({ name: 'New Preset', command: rawCommand, description: '' }); }} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-focus)', marginBottom: '1rem' }}>+ Create New</button>
                   {presets.map(p => (
                       <div key={p.id} className={`preset-list-item ${presetFocusId === p.id ? 'active' : ''}`} onClick={() => { setPresetFocusId(p.id); setPresetDraft({ ...p }); }}>
                          <strong>{p.name}</strong>
                       </div>
                   ))}
               </div>
               <div className="preset-editor">
                   <h2>{presetFocusId ? 'Edit Preset' : 'Create Preset'}</h2>
                   
                   <div><label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Preset Title</label>
                   <input type="text" value={presetDraft.name || ''} onChange={e => setPresetDraft({ ...presetDraft, name: e.target.value })} /></div>

                   <div><label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Description (Optional)</label>
                   <textarea rows={3} value={presetDraft.description || ''} onChange={e => setPresetDraft({ ...presetDraft, description: e.target.value })} placeholder="Document codecs, targets, or specific use-cases here..."></textarea></div>

                   <div><label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Raw Command Dissection String</label>
                   <textarea rows={4} value={presetDraft.command || ''} onChange={e => setPresetDraft({ ...presetDraft, command: e.target.value })} placeholder="-i input.mp4 ..."></textarea></div>

                   <hr style={{ borderColor: 'var(--border-subtle)', margin: '1rem 0' }} />
                   
                   <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                       <div>
                          {presetFocusId && <button onClick={() => { if(confirm('Delete ' + presetDraft.name + '?')) { setPresets(prev => prev.filter(x => x.id !== presetFocusId)); setPresetFocusId(null); setPresetDraft({ name: 'New Preset', command: rawCommand, description: '' }); } }} style={{ backgroundColor: 'transparent', border: '1px solid var(--accent-red)', color: 'var(--accent-red)' }}>Trash Preset</button>}
                       </div>
                       <div style={{ display: 'flex', gap: '1rem' }}>
                          <button onClick={async () => { const p = await save({filters:[{name:'JSON', extensions:['json']}]}); if(p) { await writeTextFile(p, JSON.stringify(presets, null, 2)); alert("Exported!"); } }} style={{ backgroundColor: 'transparent', border: '1px solid var(--border-focus)' }}>Export All</button>
                          <button onClick={async () => { const p = await open({filters:[{name:'JSON', extensions:['json']}]}); if(typeof p==='string'){ const d=await readTextFile(p); setPresets(prev=>[...prev,...JSON.parse(d)]); } }} style={{ backgroundColor: 'transparent', border: '1px solid var(--border-focus)' }}>Import</button>
                          
                          <button onClick={() => setShowPresetManager(false)} style={{ backgroundColor: 'transparent', border: '1px solid var(--border-subtle)' }}>Close</button>
                          
                          <button onClick={() => {
                              if (!presetDraft.name || !presetDraft.command) return alert('Title and Command required!');
                              if (presetFocusId) {
                                  setPresets(prev => prev.map(p => p.id === presetFocusId ? { ...p, ...presetDraft } as Preset : p));
                                  // Update the active command if it's currently selected
                                  if (selectedPresetId === presetFocusId) { setRawCommand(presetDraft.command || ''); setBlocks(parseFfmpegCommand(presetDraft.command || '')); }
                              } else {
                                  setPresets(prev => [...prev, { id: 'p_' + Date.now(), name: presetDraft.name!, description: presetDraft.description || '', command: presetDraft.command! }]);
                              }
                              setShowPresetManager(false);
                          }}>Save Preset To Vault</button>
                       </div>
                   </div>
               </div>
            </div>
         </div>
      )}

      {showBatchModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Batch Output Settings</h2>
            <p>You have selected <strong>{batchFiles.length}</strong> input files to process.</p>
            <div className="radio-group" style={{ marginTop: '1rem' }}>
              <label className="radio-item"><input type="radio" value="original" checked={batchMode === 'original'} onChange={() => setBatchMode('original')} /> Save adjacent to Original Folder</label>
              <label className="radio-item"><input type="radio" value="destination" checked={batchMode === 'destination'} onChange={() => setBatchMode('destination')} /> Select Universal Destination Folder</label>
            </div>
            {batchMode === 'destination' && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                 <button onClick={handlePickBatchDest} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-focus)', fontSize: '0.85rem' }}>Browse...</button>
                 <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)'}}>{batchDestFolder || 'No folder selected'}</span>
              </div>
            )}
            <div><label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Filename Suffix</label><input type="text" value={batchSuffix} onChange={e => setBatchSuffix(e.target.value)} placeholder="_encoded" /></div>
            <hr style={{ borderColor: 'var(--border-subtle)', margin: '1rem 0' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button onClick={() => setShowBatchModal(false)} style={{ backgroundColor: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={finalizeBatchJobs} disabled={batchMode === 'destination' && !batchDestFolder}>Generate {batchFiles.length} Jobs</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
