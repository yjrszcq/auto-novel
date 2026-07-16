export interface BrowserSpeechEngine {
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
}

export const createBrowserSpeechController = (
  engine: BrowserSpeechEngine | undefined,
  createUtterance: ((text: string) => SpeechSynthesisUtterance) | undefined,
) => ({
  isAvailable: engine !== undefined && createUtterance !== undefined,
  speak: (text: string, language: string) => {
    if (
      engine === undefined ||
      createUtterance === undefined ||
      text.trim().length === 0
    ) {
      return false;
    }
    const utterance = createUtterance(text);
    utterance.lang = language;
    engine.cancel();
    engine.speak(utterance);
    return true;
  },
  stop: () => engine?.cancel(),
});
