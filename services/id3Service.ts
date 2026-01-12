
import { AudioMetadata } from '../types.ts';
import ID3Writer from 'browser-id3-writer';
import { GoogleGenAI, Type } from "@google/genai";

/**
 * 文字列が有効なUTF-8かどうかを判定する補助関数
 */
const isLikelyUtf8 = (bytes: Uint8Array): boolean => {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(bytes);
    return true;
  } catch {
    return false;
  }
};

/**
 * 既存のID3タグを解析します。
 */
export const parseMetadata = async (file: File, folderHint?: string): Promise<AudioMetadata> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  let title = file.name.replace(/\.[^/.]+$/, "");
  let artist = "不明なアーティスト";
  let album = folderHint || "不明なアルバム";

  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const findFrame = (frameId: string) => {
      const idBytes = new TextEncoder().encode(frameId);
      for (let i = 10; i < Math.min(bytes.length, 10000); i++) {
        if (bytes[i] === idBytes[0] && bytes[i+1] === idBytes[1] && bytes[i+2] === idBytes[2] && bytes[i+3] === idBytes[3]) {
          const size = (bytes[i+4] << 24) | (bytes[i+5] << 16) | (bytes[i+6] << 8) | bytes[i+7];
          const encoding = bytes[i+10];
          const content = bytes.slice(i + 11, i + 10 + size);
          
          if (content.length === 0) return null;

          if (encoding === 0) {
            if (isLikelyUtf8(content)) {
              return new TextDecoder('utf-8').decode(content).replace(/\0/g, '').trim();
            } else {
              return new TextDecoder('shift-jis').decode(content).replace(/\0/g, '').trim();
            }
          }
          try {
            const dec = encoding === 1 || encoding === 2 ? new TextDecoder('utf-16') : new TextDecoder('utf-8');
            return dec.decode(content).replace(/\0/g, '').trim();
          } catch {
            return null;
          }
        }
      }
      return null;
    };

    const t = findFrame('TIT2');
    const ar = findFrame('TPE1');
    const al = findFrame('TALB');

    const isJunk = (str: string | null) => !str || /[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/.test(str);

    if (!isJunk(t)) title = t!;
    if (!isJunk(ar)) artist = ar!;
    if (!isJunk(al)) album = al!;
  }

  return {
    title,
    artist,
    album,
    originalEncoding: 'Unknown'
  };
};

/**
 * Gemini APIを使用して、ファイル名から情報を推測します。
 */
export const inferMetadataWithAI = async (filename: string, foldername?: string): Promise<Partial<AudioMetadata>> => {
  // CRITICAL: SDKの指示に従い、インスタンスは関数内で作成する
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `ユーザーはWindowsエクスプローラーで正しく表示されているファイル名を元に、音楽タグを整理したいと考えています。
      提供する「ファイル名」から情報を抽出してください。
      
      ファイル名: "${filename}"
      親フォルダ名: "${foldername || 'なし'}"
      
      出力項目:
      - title: 曲名（トラック番号、拡張子、付加情報は削除）
      - artist: 歌手名（不明なら"不明なアーティスト"）
      - album: アルバム名（フォルダ名から推測、不明なら"不明なアルバム"）`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            artist: { type: Type.STRING },
            album: { type: Type.STRING },
          },
          required: ["title", "artist", "album"]
        },
      },
    });

    // response.text プロパティを直接参照
    const text = response.text || "{}";
    return JSON.parse(text);
  } catch (error) {
    console.error("AI inference failed:", error);
    return {};
  }
};

const getAudioDataOnly = (buffer: ArrayBuffer): ArrayBuffer => {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    const offset = size + 10;
    return buffer.slice(offset);
  }
  return buffer;
};

export const fixFileTags = async (file: File, metadata: AudioMetadata): Promise<Blob> => {
  const buffer = await file.arrayBuffer();
  const audioData = getAudioDataOnly(buffer);
  
  const writer = new ID3Writer(audioData);
  if (metadata.title) writer.setFrame('TIT2', metadata.title);
  if (metadata.artist) writer.setFrame('TPE1', [metadata.artist]);
  if (metadata.album) writer.setFrame('TALB', metadata.album);
  
  writer.addTag();
  return new Blob([writer.arrayBuffer], { type: 'audio/mpeg' });
};
