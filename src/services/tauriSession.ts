import { invoke } from '@tauri-apps/api/core';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: any;
  }
}

export interface SessionMetadata {
  id: string;
  title: string;
  created_at: number;
  formatted_date: string;
  duration_seconds: number;
  transcript_count: number;
}

export interface TranscriptItem {
  id: string;
  timestamp_sec: number;
  formatted_time: string;
  speaker: string;
  text: string;
}

export interface SessionData {
  metadata: SessionMetadata;
  transcripts: TranscriptItem[];
  notes: string;
}

// Fallback dummy session data for standard browser preview mode
const mockSessions: SessionMetadata[] = [
  {
    id: 'session_1',
    title: 'Product Architecture Sync',
    created_at: Date.now() - 3600000,
    formatted_date: 'Today, 2:30 PM',
    duration_seconds: 860,
    transcript_count: 3,
  },
  {
    id: 'session_2',
    title: 'Sprint Retrospective & Roadmap',
    created_at: Date.now() - 86400000,
    formatted_date: 'Yesterday, 10:00 AM',
    duration_seconds: 1925,
    transcript_count: 12,
  },
];

const mockSessionDataMap: Record<string, SessionData> = {
  session_1: {
    metadata: mockSessions[0],
    transcripts: [
      { id: 't_1', timestamp_sec: 2, formatted_time: '00:02', speaker: 'Speaker 1', text: 'Welcome everyone to the Atlas AI Desktop technical review.' },
      { id: 't_2', timestamp_sec: 15, formatted_time: '00:15', speaker: 'Speaker 1', text: 'Today we are testing real-time local audio transcription running on whisper.cpp.' },
      { id: 't_3', timestamp_sec: 45, formatted_time: '00:45', speaker: 'Speaker 2', text: 'Awesome. Zero cloud dependencies means 100% privacy and instant response time.' },
    ],
    notes: "# Product Architecture Notes\n\n- Local STT powered by whisper.cpp base.en model.\n- Local LLM powered by Ollama llama3.2:3b.\n- macOS Apple Vision framework for zero-cloud OCR.\n",
  },
};

export async function fetchSessions(): Promise<SessionMetadata[]> {
  try {
    if (window.__TAURI_INTERNALS__) {
      return await invoke<SessionMetadata[]>('list_sessions');
    }
  } catch (err) {
    console.warn('Tauri IPC list_sessions fallback to mock:', err);
  }
  return mockSessions;
}

export async function createNewSession(title?: string): Promise<SessionData> {
  try {
    if (window.__TAURI_INTERNALS__) {
      return await invoke<SessionData>('create_session', { title });
    }
  } catch (err) {
    console.warn('Tauri IPC create_session fallback to mock:', err);
  }

  const newId = `session_${Date.now()}`;
  const newSessionData: SessionData = {
    metadata: {
      id: newId,
      title: title || `New Session (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
      created_at: Date.now(),
      formatted_date: 'Just now',
      duration_seconds: 0,
      transcript_count: 0,
    },
    transcripts: [],
    notes: '# New Session Notes\n\nStart recording or typing notes here...\n',
  };

  mockSessions.unshift(newSessionData.metadata);
  mockSessionDataMap[newId] = newSessionData;
  return newSessionData;
}

export async function loadSessionById(id: string): Promise<SessionData> {
  try {
    if (window.__TAURI_INTERNALS__) {
      return await invoke<SessionData>('load_session', { id });
    }
  } catch (err) {
    console.warn('Tauri IPC load_session fallback to mock:', err);
  }

  return mockSessionDataMap[id] || {
    metadata: { id, title: 'Session', created_at: Date.now(), formatted_date: 'Today', duration_seconds: 0, transcript_count: 0 },
    transcripts: [],
    notes: '',
  };
}

export async function saveSessionNotes(id: string, notes: string): Promise<void> {
  try {
    if (window.__TAURI_INTERNALS__) {
      await invoke('save_session_notes', { id, notes });
      return;
    }
  } catch (err) {
    console.warn('Tauri IPC save_session_notes fallback to mock:', err);
  }

  if (mockSessionDataMap[id]) {
    mockSessionDataMap[id].notes = notes;
  }
}

export async function deleteSessionById(id: string): Promise<void> {
  try {
    if (window.__TAURI_INTERNALS__) {
      await invoke('delete_session', { id });
      return;
    }
  } catch (err) {
    console.warn('Tauri IPC delete_session fallback to mock:', err);
  }
  delete mockSessionDataMap[id];
}
