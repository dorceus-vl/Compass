// A user message that carried documents stores their names and ids as one last line (sealed with the message); the extracted text is never stored.
export interface Attachment { id: string; name: string }
const TAG = '\n\n[[attachments]] ';

export const withAttachments = (text: string, list: Attachment[]) => (list.length ? text + TAG + JSON.stringify(list.map(({ id, name }) => ({ id, name }))) : text);

export function splitAttachments(content: string): { text: string; attachments: Attachment[] } {
  const at = content.lastIndexOf(TAG);
  if (at < 0) return { text: content, attachments: [] };
  try {
    const list: unknown = JSON.parse(content.slice(at + TAG.length));
    if (Array.isArray(list) && list.every((a) => typeof a?.id === 'string' && typeof a?.name === 'string')) return { text: content.slice(0, at), attachments: list.map(({ id, name }) => ({ id, name })) };
  } catch { /* a message that merely contains the marker */ }
  return { text: content, attachments: [] };
}
