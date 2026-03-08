const STORAGE_KEY = "knovie_conversations";
const MAX_CONVERSATIONS = 50;

export interface SavedConversation {
  id: string;
  topicId: string;
  topicName: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface StoredConversation extends SavedConversation {
  messages: { role: string; content: string; id?: string }[];
}

function getAll(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAll(convos: StoredConversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convos.slice(0, MAX_CONVERSATIONS)));
  } catch { /* storage full or unavailable */ }
}

export function listConversations(): SavedConversation[] {
  return getAll().map(({ messages, ...rest }) => rest);
}

export function getConversation(id: string): StoredConversation | null {
  return getAll().find((c) => c.id === id) || null;
}

export function saveConversation(
  id: string,
  topicId: string,
  topicName: string,
  messages: { role: string; content: string; id?: string }[],
) {
  const convos = getAll();
  const existing = convos.find((c) => c.id === id);
  const firstUserMsg = messages.find((m) => m.role === "user");
  const title = firstUserMsg?.content.slice(0, 40) || "新对话";
  const now = new Date().toISOString();

  if (existing) {
    existing.topicId = topicId;
    existing.topicName = topicName;
    existing.title = title;
    existing.messages = messages;
    existing.messageCount = messages.length;
    existing.updatedAt = now;
  } else {
    convos.unshift({
      id,
      topicId,
      topicName,
      title,
      messages,
      messageCount: messages.length,
      createdAt: now,
      updatedAt: now,
    });
  }

  convos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  saveAll(convos);
}

export function deleteConversation(id: string) {
  const convos = getAll().filter((c) => c.id !== id);
  saveAll(convos);
}

export function getConversationMessages(id: string) {
  return getConversation(id)?.messages || [];
}

/**
 * Placeholder for future server-side sync.
 * When auth is implemented, call this after saving locally
 * to persist conversations to the backend database.
 */
export async function syncToServer(_id: string): Promise<void> {
  // TODO: POST /api/conversations/:id with messages when AUTH_ENABLED
}
