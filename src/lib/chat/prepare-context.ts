/** Complete every fallible read before persisting the user's message. */
export async function prepareChatContext<TMessage, TMemory>(
  memoryPromise: Promise<TMemory>,
  priorHistoryPromise: Promise<TMessage[]>,
  saveCurrent: () => Promise<TMessage | null>,
): Promise<{ memory: TMemory; history: TMessage[]; saved: TMessage | null }> {
  const [memory, priorHistory] = await Promise.all([memoryPromise, priorHistoryPromise]);
  const saved = await saveCurrent();
  return { memory, history: saved ? [...priorHistory, saved] : priorHistory, saved };
}
