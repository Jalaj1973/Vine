import { invoke } from '@tauri-apps/api/core';
import { loadSessionById } from './tauriSession';

export async function exportSessionToMarkdown(sessionId: string): Promise<string> {
  try {
    if (window.__TAURI_INTERNALS__) {
      return await invoke<string>('export_session_markdown', { id: sessionId });
    }
  } catch (err) {
    console.warn('Tauri export_session_markdown fallback:', err);
  }

  // Browser fallback download
  const sessionData = await loadSessionById(sessionId);
  let mdContent = `# ${sessionData.metadata.title}\n\n`;
  mdContent += `- **Session ID**: ${sessionData.metadata.id}\n`;
  mdContent += `- **Date**: ${sessionData.metadata.formatted_date}\n\n`;
  mdContent += `## 📝 Session Notes\n\n${sessionData.notes}\n\n---\n\n`;
  mdContent += `## 🎙️ Speech Transcripts & Captured Text\n\n`;
  sessionData.transcripts.forEach(t => {
    mdContent += `#### [${t.formatted_time}] ${t.speaker}\n${t.text}\n\n`;
  });

  const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `Atlas_Session_${sessionId}.md`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return `~/Downloads/Atlas_Session_${sessionId}.md`;
}
