import type { JarvisDesktopBridge } from "./preload";

declare global {
  interface Window {
    jarvisDesktop: {
      getRuntimeStatus: JarvisDesktopBridge["getRuntimeStatus"];
      getModelReadiness: JarvisDesktopBridge["getModelReadiness"];
      getPairingCode: JarvisDesktopBridge["getPairingCode"];
      getVoiceStatus: JarvisDesktopBridge["getVoiceStatus"];
      setVoiceMute: JarvisDesktopBridge["setVoiceMute"];
      getMemoryItems: JarvisDesktopBridge["getMemoryItems"];
      addMemoryItem: JarvisDesktopBridge["addMemoryItem"];
      deleteMemoryItem: JarvisDesktopBridge["deleteMemoryItem"];
      clearMemory: JarvisDesktopBridge["clearMemory"];
      getActions: JarvisDesktopBridge["getActions"];
      proposeAction: JarvisDesktopBridge["proposeAction"];
      decideAction: JarvisDesktopBridge["decideAction"];
      executeTerminalCommand: JarvisDesktopBridge["executeTerminalCommand"];
      captureScreenshot: JarvisDesktopBridge["captureScreenshot"];
      listProjectFiles: JarvisDesktopBridge["listProjectFiles"];
      readFileContent: JarvisDesktopBridge["readFileContent"];
      queryDocumentRag: JarvisDesktopBridge["queryDocumentRag"];
      fetchWebPage: JarvisDesktopBridge["fetchWebPage"];
      searchWeb: JarvisDesktopBridge["searchWeb"];
      getAgentTasks: JarvisDesktopBridge["getAgentTasks"];
      startAgentCollaboration: JarvisDesktopBridge["startAgentCollaboration"];
      getWorkflows: JarvisDesktopBridge["getWorkflows"];
      runWorkflow: JarvisDesktopBridge["runWorkflow"];
      getKnowledgeItems: JarvisDesktopBridge["getKnowledgeItems"];
      addKnowledgeItem: JarvisDesktopBridge["addKnowledgeItem"];
      deleteKnowledgeItem: JarvisDesktopBridge["deleteKnowledgeItem"];
      getDiagnostics: JarvisDesktopBridge["getDiagnostics"];
      startChat: JarvisDesktopBridge["startChat"];
      cancelChat: JarvisDesktopBridge["cancelChat"];
      onChatEvent: JarvisDesktopBridge["onChatEvent"];
      onLiveEvent: JarvisDesktopBridge["onLiveEvent"];
      onTerminalOutput: JarvisDesktopBridge["onTerminalOutput"];
      onDictateShortcut: JarvisDesktopBridge["onDictateShortcut"];
      writeClipboard: JarvisDesktopBridge["writeClipboard"];
      /** xAI STT: Audiodaten transkribieren */
      transcribeAudio: JarvisDesktopBridge["transcribeAudio"];
      /** xAI TTS: Text in MP3-Audio umwandeln */
      synthesizeSpeech: JarvisDesktopBridge["synthesizeSpeech"];
      getConfig: JarvisDesktopBridge["getConfig"];
      updateConfig: JarvisDesktopBridge["updateConfig"];
      ensureOllama: JarvisDesktopBridge["ensureOllama"];
      ensureBarehands: JarvisDesktopBridge["ensureBarehands"];
      getBarehandsStatus: JarvisDesktopBridge["getBarehandsStatus"];
      stopBarehands: JarvisDesktopBridge["stopBarehands"];
      barehandsPushEvent: JarvisDesktopBridge["barehandsPushEvent"];
    };
  }
}

export {};
