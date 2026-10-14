export type AiRole = 'system' | 'user' | 'assistant';

export interface AiTextPart {
  type: 'text';
  text: string;
}

export interface AiImagePart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export type ContentPart = AiTextPart | AiImagePart;
export type AiContent = string | ContentPart[];

export interface AiMessage {
  role: AiRole;
  content: AiContent;
}
