import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { 
  Mic, 
  Square, 
  Sparkles, 
  Crop, 
  FileText, 
  Download, 
  Clock, 
  ChevronRight,
  ShieldCheck,
  Plus,
  Trash2,
  Save,
  BookOpen,
  Volume2,
  RefreshCw,
  Zap,
  Radio,
  ChevronDown,
  CheckCircle2,
  Terminal,
  Globe,
  Gauge,
  Minimize2,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Eye,
  Move
} from 'lucide-react';
import { 
  fetchSessions, 
  createNewSession, 
  loadSessionById, 
  saveSessionNotes, 
  deleteSessionById,
  SessionMetadata,
  SessionData,
  TranscriptItem 
} from './services/tauriSession';
import { globalAudioRecorder, TranscriptionDelta } from './services/audioRecorder';
import { fetchOllamaStatus, streamOllamaAssistantTokens, askOllamaAssistant, OllamaStatus, computeHash } from './services/ollamaService';
import { triggerScreenCaptureOCR, triggerActiveBrowserTabOCR } from './services/ocrService';
import { exportSessionToMarkdown } from './services/exportService';
import { getMicrophoneDevices, MicDevice } from './services/micDeviceService';

export default function App() {
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [activeSession, setActiveSession] = useState<SessionData | null>(null);
  const [notesText, setNotesText] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeTab, setActiveTab] = useState<'transcript' | 'notes'>('transcript');
  const [isCapturingOcr, setIsCapturingOcr] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  
  // Controls
  const [autoCoPilotEnabled, setAutoCoPilotEnabled] = useState<boolean>(true);
  const [autoScreenMonitorEnabled, setAutoScreenMonitorEnabled] = useState<boolean>(false);
  const [windowOpacity, setWindowOpacity] = useState<number>(0.95);
  
  // UI Layout States: Minimalist HUD Mode & Collapsible Sidebars
  const [isMiniHudMode, setIsMiniHudMode] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);

  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [lastTtftMs, setLastTtftMs] = useState<number | null>(null);
  
  const processedHashesRef = useRef<Set<string>>(new Set());
  const isThinkingRef = useRef<boolean>(false);
  const selectedModelRef = useRef<string>('qwen2.5-coder:1.5b');
  const autoCoPilotRef = useRef<boolean>(true);
  const recordingSecondsRef = useRef<number>(0);

  // Microphone Devices State
  const [micDevices, setMicDevices] = useState<MicDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('default');

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({
    online: false,
    active_model: 'llama3.2:3b',
    models: []
  });
  const [selectedModel, setSelectedModel] = useState<string>('qwen2.5-coder:1.5b');
  const [isAiThinking, setIsAiThinking] = useState(false);

  useEffect(() => {
    isThinkingRef.current = isAiThinking;
  }, [isAiThinking]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    autoCoPilotRef.current = autoCoPilotEnabled;
  }, [autoCoPilotEnabled]);

  useEffect(() => {
    recordingSecondsRef.current = recordingSeconds;
  }, [recordingSeconds]);

  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string }>>([
    { sender: 'ai', text: 'Hello! I am your local Live Meeting & Browser Co-Pilot. Toggle "Chrome Monitor ON" when you want me to scan active webpage tabs for solutions.' }
  ]);

  // Reliable Native Mouse Drag Handler via Tauri start_window_drag
  const handleWindowDrag = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.closest('button')) {
      return;
    }

    try {
      if (window.__TAURI_INTERNALS__) {
        await invoke('start_window_drag');
      }
    } catch (err) {
      console.warn('Native window drag notice:', err);
    }
  };

  const addDebugLog = (msg: string) => {
    console.log(`[APP LOG] ${msg}`);
    setDebugLogs(prev => [msg, ...prev.slice(0, 10)]);
  };

  // Load initial data
  useEffect(() => {
    async function initData() {
      const list = await fetchSessions();
      setSessions(list);
      if (list.length > 0) {
        const fullData = await loadSessionById(list[0].id);
        setActiveSession(fullData);
        setNotesText(fullData.notes);
      } else {
        const initialSession = await createNewSession();
        setSessions([initialSession.metadata]);
        setActiveSession(initialSession);
        setNotesText(initialSession.notes);
      }

      const status = await fetchOllamaStatus();
      setOllamaStatus(status);
      if (status.active_model) {
        setSelectedModel(status.active_model);
      }

      const mics = await getMicrophoneDevices();
      setMicDevices(mics);
      if (mics.length > 0) {
        setSelectedMicId(mics[0].deviceId);
      }
    }
    initData();
  }, []);

  // Timer interval for recording
  useEffect(() => {
    let interval: any = null;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingSeconds(sec => sec + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  // Non-blocking Chrome Tab Monitor Loop (Every 4 seconds)
  // All frequently-changing values are read from refs to avoid tearing down/recreating the interval
  useEffect(() => {
    let screenInterval: ReturnType<typeof setInterval> | null = null;

    if (autoScreenMonitorEnabled) {
      screenInterval = setInterval(async () => {
        if (isThinkingRef.current) {
          return;
        }

        try {
          const browserTabText = await triggerActiveBrowserTabOCR();
          
          if (
            browserTabText && 
            browserTabText.length > 25 && 
            !browserTabText.includes('Atlas Co-Pilot') &&
            !browserTabText.includes('Atlas AI Desktop')
          ) {
            const currentHash = await computeHash(browserTabText.trim());
            
            if (processedHashesRef.current.has(currentHash)) {
              return;
            }

            const looksLikeQuestion = /[?]|problem|given|constraints|complexity|example|input|output|solution|function|class|return|leetcode/i.test(browserTabText);

            if (looksLikeQuestion && autoCoPilotRef.current) {
              processedHashesRef.current.add(currentHash);
              setIsAiThinking(true);
              isThinkingRef.current = true;

              const currentModel = selectedModelRef.current;
              const currentRecSec = recordingSecondsRef.current;
              const startTime = performance.now();
              addDebugLog(`⚡ New Chrome Question Detected! Generating solution via ${currentModel}...`);
              
              const prompt = `Active Chrome/Browser Tab Problem Statement:\n${browserTabText}\n\nProvide an instant, concise solution with explanation & optimal code solution:`;
              
              // Use functional updater to get correct index without stale closure
              let aiMsgIndex = -1;
              setMessages(prev => {
                aiMsgIndex = prev.length;
                return [...prev, { sender: 'ai' as const, text: '⚡ [Real-time Solution Stream]\n' }];
              });

              const streamItemId = `browser_sol_${Date.now()}`;
              setActiveSession(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  transcripts: [
                    ...prev.transcripts,
                    {
                      id: streamItemId,
                      timestamp_sec: currentRecSec,
                      formatted_time: formatTimer(currentRecSec),
                      speaker: `⚡ Real-time AI Solution (${currentModel})`,
                      text: '',
                    }
                  ]
                };
              });

              let accumulatedTokens = '⚡ [Real-time Solution Stream]\n';
              let accumulatedTranscript = '';
              let hasRecordedTtft = false;

              try {
                await streamOllamaAssistantTokens(
                  prompt,
                  'You are an expert technical interviewer and coding assessment assistant.',
                  currentModel,
                  (token) => {
                    if (!hasRecordedTtft) {
                      hasRecordedTtft = true;
                      const ttft = Math.round(performance.now() - startTime);
                      setLastTtftMs(ttft);
                      addDebugLog(`⚡ Response Speed: ${ttft}ms TTFT`);
                    }

                    accumulatedTokens += token;
                    accumulatedTranscript += token;

                    setMessages(prev => {
                      const updated = [...prev];
                      if (aiMsgIndex >= 0 && updated[aiMsgIndex]) {
                        updated[aiMsgIndex] = { sender: 'ai', text: accumulatedTokens };
                      }
                      return updated;
                    });

                    setActiveSession(prev => {
                      if (!prev) return prev;
                      const transcripts = [...prev.transcripts];
                      const targetIdx = transcripts.findIndex(t => t.id === streamItemId);
                      if (targetIdx !== -1) {
                        transcripts[targetIdx] = {
                          ...transcripts[targetIdx],
                          text: accumulatedTranscript,
                        };
                      }
                      return { ...prev, transcripts };
                    });
                  }
                );
              } catch (_) {} finally {
                setIsAiThinking(false);
                isThinkingRef.current = false;
              }
            }
          }
        } catch (_) {}
      }, 4000);
    }

    return () => { if (screenInterval) clearInterval(screenInterval); };
  }, [autoScreenMonitorEnabled]);

  // Auto-scroll transcript container
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.transcripts]);

  const refreshMicDevices = async () => {
    const mics = await getMicrophoneDevices();
    setMicDevices(mics);
    const status = await fetchOllamaStatus();
    setOllamaStatus(status);
    addDebugLog(`Scanned ${mics.length} mic devices`);
  };

  const handleSelectSession = async (id: string) => {
    if (isRecording) {
      await stopRecordingSession();
    }
    const data = await loadSessionById(id);
    setActiveSession(data);
    setNotesText(data.notes);
  };

  const handleCreateSession = async () => {
    if (isRecording) {
      await stopRecordingSession();
    }
    const newSessionData = await createNewSession();
    const updatedList = await fetchSessions();
    setSessions(updatedList);
    setActiveSession(newSessionData);
    setNotesText(newSessionData.notes);
    addDebugLog(`Created session ${newSessionData.metadata.id}`);
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRecording && activeSession?.metadata.id === id) {
      await stopRecordingSession();
    }
    await deleteSessionById(id);
    const updatedList = await fetchSessions();
    setSessions(updatedList);
    if (updatedList.length > 0) {
      const firstData = await loadSessionById(updatedList[0].id);
      setActiveSession(firstData);
      setNotesText(firstData.notes);
    } else {
      const newSessionData = await createNewSession();
      setSessions([newSessionData.metadata]);
      setActiveSession(newSessionData);
      setNotesText(newSessionData.notes);
    }
  };

  const handleExportMarkdown = async () => {
    if (!activeSession) return;
    try {
      const exportPath = await exportSessionToMarkdown(activeSession.metadata.id);
      setExportNotice(`Exported session to ${exportPath}`);
      setTimeout(() => setExportNotice(null), 4500);
    } catch (err: any) {
      console.error('Export error:', err);
    }
  };

  const handleTriggerOCR = async () => {
    try {
      setIsCapturingOcr(true);
      const text = await triggerScreenCaptureOCR();
      
      if (text && !text.includes('cancelled')) {
        const appendedNotes = `${notesText}\n\n### 📷 Screen Region Capture (${new Date().toLocaleTimeString()})\n\`\`\`text\n${text}\n\`\`\`\n`;
        setNotesText(appendedNotes);
        if (activeSession) {
          saveSessionNotes(activeSession.metadata.id, appendedNotes);
        }

        if (autoCoPilotEnabled) {
          setIsAiThinking(true);
          const solution = await askOllamaAssistant(
            `Question Captured from Screen Region:\n${text}\n\nProvide the instant answer and code solution:`,
            'You are an expert technical interview co-pilot.',
            selectedModel
          );

          setMessages(prev => [...prev, { sender: 'ai', text: `📷 [Region Capture Answer]\n${solution}` }]);
          setIsAiThinking(false);
        }

        setActiveTab('notes');
      }
    } catch (err: any) {
      console.log('OCR action:', err.message || err);
    } finally {
      setIsCapturingOcr(false);
    }
  };

  const startRecordingSession = async () => {
    let targetSession = activeSession;
    if (!targetSession) {
      targetSession = await createNewSession();
      setActiveSession(targetSession);
    }

    addDebugLog(`Recording mic: ${selectedMicId}`);

    const success = await globalAudioRecorder.startRecording(
      targetSession.metadata.id,
      selectedMicId,
      async (delta: TranscriptionDelta) => {
        addDebugLog(`Speech: ${delta.formatted_time} - ${delta.text}`);

        setActiveSession(prev => {
          if (!prev) return prev;
          const transcripts = [...prev.transcripts];
          const lastIdx = transcripts.length - 1;

          if (lastIdx >= 0 && transcripts[lastIdx].speaker === delta.speaker && transcripts[lastIdx].formatted_time === delta.formatted_time) {
            transcripts[lastIdx] = {
              ...transcripts[lastIdx],
              text: delta.text,
            };
          } else {
            transcripts.push({
              id: `t_${Date.now()}_${Math.random()}`,
              timestamp_sec: delta.timestamp_sec,
              formatted_time: delta.formatted_time,
              speaker: delta.speaker,
              text: delta.text,
            });
          }

          return {
            ...prev,
            transcripts,
            metadata: {
              ...prev.metadata,
              transcript_count: transcripts.length,
              duration_seconds: delta.timestamp_sec,
            }
          };
        });

        // Instant Spoken Question Detector
        const isSpokenQuestion = /[?]|how|what|why|explain|implement|write|difference|can you/i.test(delta.text);
        if (isSpokenQuestion && autoCoPilotEnabled && delta.text.length > 8 && !isAiThinking) {
          setIsAiThinking(true);
          try {
            const spokenAnswer = await askOllamaAssistant(
              `The interviewer just asked: "${delta.text}"\n\nProvide a direct, high-impact instant interview answer with bullet points or code if requested:`,
              'You are a senior tech interview co-pilot giving real-time call answers.',
              selectedModel
            );

            setMessages(prev => [...prev, { sender: 'ai', text: `⚡ [Instant Spoken Answer]\n${spokenAnswer}` }]);

            setActiveSession(prev => {
              if (!prev) return prev;
              const aiItem: TranscriptItem = {
                id: `spoken_ans_${Date.now()}`,
                timestamp_sec: delta.timestamp_sec,
                formatted_time: delta.formatted_time,
                speaker: '⚡ Instant Spoken AI Answer',
                text: spokenAnswer,
              };
              return {
                ...prev,
                transcripts: [...prev.transcripts, aiItem]
              };
            });
          } catch (_) {} finally {
            setIsAiThinking(false);
          }
        }
      }
    );

    if (success) {
      setIsRecording(true);
      addDebugLog('Recording session active');
    } else {
      addDebugLog('ERROR: Failed to start recording');
    }
  };

  const stopRecordingSession = async () => {
    globalAudioRecorder.stopRecording();
    setIsRecording(false);
    addDebugLog('Recording session stopped');
    const list = await fetchSessions();
    setSessions(list);
  };

  const toggleRecording = async () => {
    if (isRecording) {
      await stopRecordingSession();
    } else {
      await startRecordingSession();
    }
  };

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNotesText(val);
    if (activeSession) {
      saveSessionNotes(activeSession.metadata.id, val);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isAiThinking) return;

    const userText = chatInput;
    setMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setChatInput('');
    setIsAiThinking(true);

    const transcriptText = activeSession?.transcripts.map(t => `[${t.formatted_time}] ${t.speaker}: ${t.text}`).join('\n') || '';
    const systemContext = `You are Atlas AI, an offline meeting & technical interview co-pilot.
Session Title: ${activeSession?.metadata.title || 'Untitled Session'}
Session Notes:
${notesText}

Session Transcript & Screen Context:
${transcriptText}`;

    try {
      const response = await askOllamaAssistant(userText, systemContext, selectedModel);
      setMessages(prev => [...prev, { sender: 'ai', text: response }]);
    } catch (err) {
      setMessages(prev => [...prev, { sender: 'ai', text: 'Error connecting to local Ollama assistant.' }]);
    } finally {
      setIsAiThinking(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ----------------------------------------------------------------------
  // RENDER MODE 1: COMPACT MINI-HUD OVERLAY
  // ----------------------------------------------------------------------
  if (isMiniHudMode) {
    const latestTranscript = activeSession?.transcripts[activeSession.transcripts.length - 1];

    return (
      <div 
        style={{ opacity: windowOpacity }}
        className="h-screen w-screen bg-[#050810]/95 text-slate-100 flex flex-col font-sans overflow-hidden glass-minimal border border-purple-500/30 rounded-2xl shadow-2xl p-2.5 space-y-2 select-none backdrop-blur-xl"
      >
        {/* Compact Mini Drag Header */}
        <div 
          data-tauri-drag-region 
          onMouseDown={handleWindowDrag}
          className="flex items-center justify-between border-b border-slate-800/80 pb-2 cursor-move"
        >
          <div className="flex items-center space-x-2 pointer-events-none">
            <Move className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-semibold text-xs text-purple-200">Atlas HUD</span>
            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
              {selectedModel}
            </span>
          </div>

          <div className="flex items-center space-x-1.5">
            {/* Opacity Control Button */}
            <button 
              onClick={() => setWindowOpacity(prev => (prev <= 0.35 ? 0.95 : prev - 0.15))}
              className="p-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700 transition"
              title={`Adjust Transparency (${Math.round(windowOpacity * 100)}%)`}
            >
              <Eye className="w-3 h-3 text-purple-300" />
            </button>

            {/* Record Toggle */}
            <button 
              onClick={toggleRecording}
              className={`p-1 rounded-lg border text-xs font-medium transition ${
                isRecording ? 'bg-red-600 text-white border-red-500 animate-pulse' : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
              title="Toggle Live Audio Co-Pilot"
            >
              <Mic className="w-3 h-3" />
            </button>

            {/* Chrome Monitor Toggle */}
            <button 
              onClick={() => setAutoScreenMonitorEnabled(!autoScreenMonitorEnabled)}
              className={`p-1 rounded-lg border text-xs font-medium transition ${
                autoScreenMonitorEnabled ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50' : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
              title="Toggle Chrome Screen Monitor"
            >
              <Globe className="w-3 h-3" />
            </button>

            {/* Expand to Full Workspace View */}
            <button
              onClick={() => setIsMiniHudMode(false)}
              className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="Expand to Full Workspace View"
            >
              <Maximize2 className="w-3 h-3 text-blue-400" />
            </button>
          </div>
        </div>

        {/* Compact Solution / Output Display */}
        <div className="flex-1 overflow-y-auto p-2 bg-slate-900/40 border border-slate-800/80 rounded-xl space-y-2 font-mono text-[11px] leading-relaxed select-text backdrop-blur-md">
          {latestTranscript ? (
            <div className="space-y-1">
              <span className="text-[10px] text-purple-400 font-bold flex items-center gap-1">
                <Zap className="w-3 h-3 text-purple-400" /> {latestTranscript.speaker}
              </span>
              <p className="text-slate-200 whitespace-pre-wrap">{latestTranscript.text || 'Generating solution stream...'}</p>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-500 text-[11px] text-center px-4">
              Toggle "Chrome Monitor ON" when you want to scan active webpage tabs for solutions.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // RENDER MODE 2: FULL WORKSPACE VIEW
  // ----------------------------------------------------------------------
  return (
    <div style={{ opacity: windowOpacity }} className="flex h-screen w-screen overflow-hidden bg-[#060911] text-slate-200 font-sans transition-opacity">
      {/* Collapsible Left Sidebar */}
      {sidebarOpen && (
        <aside className="w-60 glass-panel flex flex-col border-r border-slate-800/80 transition-all duration-300">
          {/* Header */}
          <div className="p-3 flex items-center justify-between border-b border-slate-800/60">
            <div className="flex items-center space-x-2">
              <div className="w-6 h-6 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <h1 className="font-semibold text-xs tracking-wide text-white">Atlas Co-Pilot</h1>
                <span className="text-[9px] text-emerald-400 font-mono flex items-center gap-1">
                  <ShieldCheck className="w-2.5 h-2.5" /> Sub-150ms Stream Active
                </span>
              </div>
            </div>
            
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 hover:bg-slate-800/60 rounded-lg text-slate-400 hover:text-slate-200 transition"
              title="Collapse Sidebar"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Action: New Session */}
          <div className="p-2.5">
            <button
              onClick={handleCreateSession}
              className="w-full flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-xs shadow-md shadow-blue-600/20 transition active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Session</span>
            </button>
          </div>

          {/* Model Selector Dropdown */}
          <div className="px-2.5 pb-2 space-y-1.5">
            <div className="bg-slate-900/90 p-2 rounded-xl border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[9px] uppercase font-semibold text-purple-400 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-purple-400" /> Fast Model
                </label>
                <span className="text-[9px] text-slate-400 font-mono">140 tok/s</span>
              </div>
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full appearance-none bg-slate-800 border border-purple-500/30 rounded-lg px-2 py-1 pr-6 text-[10px] font-medium text-purple-200 focus:outline-none cursor-pointer"
                >
                  {ollamaStatus.models.map((m) => (
                    <option key={m} value={m}>
                      {m} {m.includes('qwen2.5') ? '⚡ Fast' : ''}
                    </option>
                  ))}
                  {!ollamaStatus.models.includes('qwen2.5-coder:1.5b') && (
                    <option value="qwen2.5-coder:1.5b">qwen2.5-coder:1.5b ⚡</option>
                  )}
                  {!ollamaStatus.models.includes('llama3.2:3b') && (
                    <option value="llama3.2:3b">llama3.2:3b</option>
                  )}
                </select>
                <ChevronDown className="w-3 h-3 text-purple-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Mic Dropdown */}
            <div className="bg-slate-900/90 p-2 rounded-xl border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[9px] uppercase font-semibold text-slate-400 flex items-center gap-1">
                  <Mic className="w-3 h-3 text-blue-400" /> Mic Input
                </label>
                <button onClick={refreshMicDevices} className="text-[9px] text-blue-400 hover:underline">Scan</button>
              </div>
              <div className="relative">
                <select
                  value={selectedMicId}
                  onChange={(e) => setSelectedMicId(e.target.value)}
                  className="w-full appearance-none bg-slate-800 border border-slate-700/80 rounded-lg px-2 py-1 pr-6 text-[10px] font-medium text-slate-200 focus:outline-none cursor-pointer"
                >
                  {micDevices.map((mic) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Sessions List */}
          <div className="flex-1 overflow-y-auto px-2.5 py-1 space-y-1">
            <div className="px-2 pb-1 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Meeting Sessions</div>
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleSelectSession(session.id)}
                className={`group w-full text-left p-2 rounded-xl cursor-pointer transition flex items-center justify-between ${
                  activeSession?.metadata.id === session.id 
                    ? 'bg-blue-600/15 border border-blue-500/30 text-white' 
                    : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <div className="flex flex-col space-y-0.5 overflow-hidden pr-2">
                  <span className="font-medium text-xs truncate">{session.title}</span>
                  <span className="text-[9px] text-slate-500">{session.formatted_date}</span>
                </div>

                <button
                  onClick={(e) => handleDeleteSession(session.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition rounded"
                  title="Delete Session"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Footer Metrics */}
          <div className="p-2.5 border-t border-slate-800/60 text-xs bg-slate-900/40 space-y-1">
            {lastTtftMs !== null && (
              <div className="flex items-center justify-between text-[10px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 p-1 rounded-lg">
                <span className="flex items-center gap-1 font-mono"><Gauge className="w-3 h-3 text-emerald-400" /> Speed</span>
                <span className="font-mono font-bold">{lastTtftMs} ms</span>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col h-full bg-[#060911] relative">
        {/* Notification Banner */}
        {exportNotice && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-emerald-950/90 border border-emerald-500/50 text-emerald-200 px-4 py-1.5 rounded-xl text-xs font-medium shadow-2xl flex items-center space-x-2 animate-bounce">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{exportNotice}</span>
          </div>
        )}

        {/* Native Draggable Header Bar */}
        <header 
          data-tauri-drag-region 
          onMouseDown={handleWindowDrag}
          className="h-11 border-b border-slate-800/70 px-4 flex items-center justify-between bg-slate-900/40 backdrop-blur-md cursor-move select-none"
        >
          <div className="flex items-center space-x-3 pointer-events-none">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1 hover:bg-slate-800/60 rounded-lg text-slate-400 hover:text-slate-200 transition pointer-events-auto"
                title="Expand Sidebar"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </button>
            )}

            <div className="flex items-center space-x-1.5">
              <Move className="w-3.5 h-3.5 text-purple-400" />
              <h2 className="font-semibold text-xs text-slate-100">
                {activeSession?.metadata.title || 'Live Co-Pilot Session'}
              </h2>
            </div>

            {isRecording && (
              <div className="flex items-center space-x-1.5 bg-red-500/10 border border-red-500/30 text-red-400 px-2.5 py-0.5 rounded-full text-[10px] animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                <span className="font-mono font-medium">{formatTimer(recordingSeconds)} LISTENING</span>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {/* Opacity Control Button */}
            <button 
              onClick={() => setWindowOpacity(prev => (prev <= 0.35 ? 0.95 : prev - 0.15))}
              className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700 transition"
              title={`Adjust Transparency (${Math.round(windowOpacity * 100)}%)`}
            >
              <Eye className="w-3.5 h-3.5 text-purple-300" />
            </button>

            {/* Auto Co-Pilot Toggle */}
            <button
              onClick={() => setAutoCoPilotEnabled(!autoCoPilotEnabled)}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-lg border text-[10px] font-medium transition ${
                autoCoPilotEnabled 
                  ? 'bg-purple-600/20 border-purple-500/40 text-purple-200'
                  : 'bg-slate-800/50 border-slate-700 text-slate-400'
              }`}
            >
              <Zap className={`w-3 h-3 ${autoCoPilotEnabled ? 'text-purple-400 fill-purple-400/30' : ''}`} />
              <span>{autoCoPilotEnabled ? 'Co-Pilot ON' : 'Co-Pilot OFF'}</span>
            </button>

            {/* Targeted Browser Monitor Toggle */}
            <button
              onClick={() => setAutoScreenMonitorEnabled(!autoScreenMonitorEnabled)}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-lg border text-[10px] font-medium transition ${
                autoScreenMonitorEnabled 
                  ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-200'
                  : 'bg-slate-800/50 border-slate-700 text-slate-400'
              }`}
              title="Target Google Chrome / Safari / Arc active tab for LeetCode & assessment questions"
            >
              <Globe className={`w-3 h-3 ${autoScreenMonitorEnabled ? 'text-emerald-400' : ''}`} />
              <span>{autoScreenMonitorEnabled ? 'Chrome ON' : 'Chrome OFF'}</span>
            </button>

            {/* Switcher: Transcript / Notes */}
            <div className="flex bg-slate-900/80 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setActiveTab('transcript')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition ${
                  activeTab === 'transcript' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Transcript
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition ${
                  activeTab === 'notes' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Notes (.md)
              </button>
            </div>

            {/* Export Markdown */}
            <button
              onClick={handleExportMarkdown}
              className="p-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 border border-emerald-500/40 text-[10px] transition"
              title="Export Session to Markdown"
            >
              <Download className="w-3 h-3 text-emerald-400" />
            </button>

            {/* OCR Region */}
            <button
              onClick={handleTriggerOCR}
              disabled={isCapturingOcr}
              className="p-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 text-[10px] transition disabled:opacity-50"
              title="Capture Region OCR"
            >
              <Crop className={`w-3 h-3 text-indigo-400 ${isCapturingOcr ? 'animate-spin' : ''}`} />
            </button>

            {/* Compact Mini-HUD Toggle Button */}
            <button
              onClick={() => setIsMiniHudMode(true)}
              className="p-1 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-200 border border-purple-500/40 text-[10px] font-medium transition flex items-center space-x-1"
              title="Switch to Compact Mini-HUD Mode"
            >
              <Minimize2 className="w-3 h-3 text-purple-400" />
              <span>Mini HUD</span>
            </button>

            {/* Record / Stop Button */}
            <button
              onClick={toggleRecording}
              className={`flex items-center space-x-1 px-2.5 py-0.5 rounded-xl text-[10px] font-semibold transition ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/30'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30'
              }`}
            >
              {isRecording ? <Square className="w-3 h-3 fill-current" /> : <Mic className="w-3 h-3" />}
              <span>{isRecording ? 'Stop' : 'Start'}</span>
            </button>

            {!drawerOpen && (
              <button
                onClick={() => setDrawerOpen(true)}
                className="p-1 hover:bg-slate-800/60 rounded-lg text-slate-400 hover:text-slate-200 transition ml-1"
                title="Expand AI Drawer"
              >
                <PanelRightOpen className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main Stream Section */}
          <section className="flex-1 flex flex-col p-4 overflow-y-auto">
            {activeTab === 'transcript' ? (
              <div className="space-y-3 flex-1 flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                  <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-blue-400" /> Real-time Speech Transcript & Chrome Stream
                  </h3>
                  <span className="text-[10px] text-slate-500">{activeSession?.transcripts.length || 0} entries</span>
                </div>

                <div className="space-y-2.5 flex-1 overflow-y-auto">
                  {activeSession?.transcripts.map((entry) => {
                    const isAiSolution = entry.speaker.includes('Instant') || entry.speaker.includes('Solution') || entry.speaker.includes('Answer') || entry.speaker.includes('Chrome') || entry.speaker.includes('AI');

                    return (
                      <div 
                        key={entry.id} 
                        className={`p-3.5 rounded-xl transition flex space-x-3 ${
                          isAiSolution
                            ? 'bg-purple-950/40 border border-purple-500/50 shadow-xl shadow-purple-500/10'
                            : 'glass-card hover:border-slate-700/80'
                        }`}
                      >
                        <span className="text-[11px] font-mono text-slate-500 pt-0.5">{entry.formatted_time}</span>
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center space-x-2">
                            <span className={`text-xs font-semibold ${
                              isAiSolution 
                                ? 'text-purple-300 flex items-center gap-1' 
                                : 'text-blue-400'
                            }`}>
                              {isAiSolution && <Zap className="w-3.5 h-3.5 text-purple-400 fill-purple-400/30" />}
                              {entry.speaker}
                            </span>
                          </div>
                          <p className={`text-xs leading-relaxed whitespace-pre-wrap ${isAiSolution ? 'text-purple-100 font-mono bg-purple-950/30 p-2.5 rounded-lg border border-purple-800/40' : 'text-slate-200'}`}>
                            {entry.text}
                          </p>
                        </div>
                      </div>
                    );
                  })}

                  <div ref={transcriptEndRef} />

                  {(!activeSession?.transcripts || activeSession.transcripts.length === 0) && (
                    <div className="h-48 flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-xl text-slate-500 text-xs space-y-2">
                      <Radio className="w-6 h-6 text-slate-600" />
                      <span>Click "Start Co-Pilot" or enable "Chrome Monitor ON" when you want to scan webpage tabs for solutions.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2 flex-1 flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
                  <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-emerald-400" /> Session Notes (notes.md)
                  </h3>
                  <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <Save className="w-3 h-3" /> Auto-Saved
                  </span>
                </div>

                <textarea
                  value={notesText}
                  onChange={handleNotesChange}
                  placeholder="Type markdown notes here..."
                  className="flex-1 w-full bg-slate-900/40 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/60 resize-none leading-relaxed"
                />
              </div>
            )}
          </section>

          {/* Collapsible Right Panel: AI Drawer */}
          {drawerOpen && (
            <aside className="w-72 border-l border-slate-800/80 flex flex-col bg-slate-900/20 backdrop-blur-sm transition-all duration-300">
              <div className="p-2.5 border-b border-slate-800/70 flex items-center justify-between text-xs font-semibold text-slate-200">
                <div className="flex items-center space-x-1.5">
                  <Zap className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs">Atlas Co-Pilot</span>
                </div>

                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-1 hover:bg-slate-800/60 rounded-lg text-slate-400 hover:text-slate-200 transition"
                  title="Collapse AI Drawer"
                >
                  <PanelRightClose className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {messages.map((msg, idx) => (
                  <div 
                    key={idx} 
                    className={`p-2.5 rounded-xl text-xs ${
                      msg.sender === 'user'
                        ? 'bg-blue-600/20 border border-blue-500/30 text-blue-100 ml-3'
                        : 'bg-slate-800/50 border border-slate-700/50 text-slate-200 mr-3 font-mono text-[11px]'
                    }`}
                  >
                    <span className="block text-[9px] font-medium text-slate-400 mb-0.5">
                      {msg.sender === 'user' ? 'You' : 'Atlas Co-Pilot'}
                    </span>
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                ))}

                {isAiThinking && (
                  <div className="p-2.5 rounded-xl bg-purple-950/20 border border-purple-800/30 text-purple-300 text-xs flex items-center space-x-2 mr-3">
                    <Sparkles className="w-3.5 h-3.5 animate-spin text-purple-400" />
                    <span className="text-[11px]">Streaming solution live...</span>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendMessage} className="p-2.5 border-t border-slate-800/70 flex items-center space-x-1.5">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask Co-Pilot..."
                  disabled={isAiThinking}
                  className="flex-1 bg-slate-800/80 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isAiThinking}
                  className="p-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition shadow-md disabled:opacity-50"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </form>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
