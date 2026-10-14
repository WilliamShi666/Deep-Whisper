import type {legal as zhLegal} from '../zh-CN/legal';
export const legal:Record<keyof typeof zhLegal,string> = {
  "chrome.back": "Back to Deep Whisper",
  "chrome.privacy": "Personal data",
  "chrome.terms": "Personal edition",
  "privacy.title": "Personal data",
  "privacy.storage": "Chats, profiles, memories, letters and media are saved in this installation. Configured AI providers receive the content needed for generation. Email forwarding is optional and uses your saved address.",
  "privacy.backup": "Deleting a conversation removes associated memories. Older backups contain data from their creation time; restoring one may restore subsequently deleted content. Keep backups private.",
  "terms.title": "Personal edition",
  "terms.use": "Deep Whisper Personal is a single owner, self hosted application. Obtain your own provider credentials and pay their usage charges. Submit content you have the right to use and follow provider terms.",
  "terms.ai": "AI output may be inaccurate. The release files define the code license and the separate permissions for original assets and branding."
};
