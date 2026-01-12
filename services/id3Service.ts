
import { AudioMetadata } from '../types.ts';
import ID3Writer from 'browser-id3-writer';
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * 既存のID3タグを解析し、Shift-JIS mojibakeを修正するための情報を抽出します
 */
export const parseMetadata = async (file: File, folderHint?: string): Promise<AudioMetadata> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  let title = file.name.replace(/\.[^/.]+$/, "");
  let artist = "不明なアーティスト";
  let album = folderHint || "不明なアルバム";

  // 簡易的なID3v2解析 (Shift-JIS mojibakeを拾うため)
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) { // "ID3"
    const sjisDecoder = new TextDecoder('shift-jis');
    
    const findFrame = (frameId: string) => {
      const idBytes = new TextEncoder().encode(frameId);
      for (let i = 10; i < Math.min(bytes.length, 10000); i++) {
        if (bytes[i] === idBytes[0] && bytes[i+1] === idBytes[1] && bytes[i+2] === idBytes[2] && bytes[i+3] === idBytes[3]) {
          const size = (bytes[i+4] << 24) | (bytes[i+5] << 16) | (bytes[i+6] << 8) | bytes[i+7];
          const encoding = bytes[i+10];
          const content = bytes.slice(i + 11, i + 10 + size);
          
          if (encoding === 0) {
            return sjisDecoder.decode(content).replace(/\0/g, '').trim();
          }
          return new TextDecoder().decode(content).replace(/\0/g, '').trim();
        }
      }
      return null;
    };

    title = findFrame('TIT2') || title;
    artist = findFrame('TPE1') || artist;
    album = folderHint || findFrame('TALB') || album;
  }

  // Corrected the typo 'Shift-SJS' to 'Shift-JIS' to match AudioMetadata type definition
  return {
    title,
    artist,
    album,
    originalEncoding: 'Shift-JIS'
  };
};

/**
 * Gemini APIを使用して、ファイル名とフォルダ名から正確なメタデータを推測します
 */
export const inferMetadataWithAI = async (filename: string, foldername?: string): Promise<Partial<AudioMetadata>> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `以下のファイル名とフォルダ名から、音楽のメタデータ（曲名、アーティスト名、アルバム名）を推測して抽出してください。
      ファイル名: "${filename}"
      フォルダ名: "${foldername || 'なし'}"
      
      注意:
      - トラック番号や拡張子は曲名から除いてください。
      - アーティスト名が不明な場合は"不明なアーティスト"としてください。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "曲名" },
            artist: { type: Type.STRING, description: "アーティスト名" },
            album: { type: Type.STRING, description: "アルバム名" },
          },
          required: ["title", "artist", "album"]
        },
      },
    });

    const result = JSON.parse(response.text);
    return result;
  } catch (error) {
    console.error("AI inference failed:", error);
    return {};
  }
};

/**
 * 元のファイルからオーディオデータ部分のみを抽出します
 */
const getAudioDataOnly = (buffer: ArrayBuffer): ArrayBuffer => {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    const offset = size + 10;
    return buffer.slice(offset);
  }
  return buffer;
};

/**
 * メタデータを ID3v2.3 / UTF-16 (BOM付) で書き込みます
 */
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
