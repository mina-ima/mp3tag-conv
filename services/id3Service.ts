
import { AudioMetadata } from '../types.ts';
import ID3Writer from 'browser-id3-writer';

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
    
    // タグ内のフレームを検索する簡易ロジック
    const findFrame = (frameId: string) => {
      const idBytes = new TextEncoder().encode(frameId);
      for (let i = 10; i < Math.min(bytes.length, 10000); i++) {
        if (bytes[i] === idBytes[0] && bytes[i+1] === idBytes[1] && bytes[i+2] === idBytes[2] && bytes[i+3] === idBytes[3]) {
          const size = (bytes[i+4] << 24) | (bytes[i+5] << 16) | (bytes[i+6] << 8) | bytes[i+7];
          const encoding = bytes[i+10];
          const content = bytes.slice(i + 11, i + 10 + size);
          
          // エンコーディングが0(ISO-8859-1)の場合、日本のWindows環境では実態はShift-JIS
          if (encoding === 0) {
            return sjisDecoder.decode(content).replace(/\0/g, '').trim();
          }
          // すでにUTF-16(1)やUTF-8(3)の場合は標準のデコーダーを使用（ここでは簡易化のためそのまま返すか、ブラウザ標準デコード）
          return new TextDecoder().decode(content).replace(/\0/g, '').trim();
        }
      }
      return null;
    };

    title = findFrame('TIT2') || title;
    artist = findFrame('TPE1') || artist;
    album = folderHint || findFrame('TALB') || album;
  }

  return {
    title,
    artist,
    album,
    originalEncoding: 'Shift-JIS'
  };
};

/**
 * 元のファイルからオーディオデータ部分（ID3タグを除去した部分）のみを抽出します
 */
const getAudioDataOnly = (buffer: ArrayBuffer): ArrayBuffer => {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    // ID3v2ヘッダーからタグ全体のサイズを取得 (synchsafe integer)
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
  
  // ID3Writerを使用して新しいタグを作成
  // browser-id3-writerはデフォルトでID3v2.3を使用し、文字列はUTF-16 (with BOM) で書き込みます
  const writer = new ID3Writer(audioData);
  
  if (metadata.title) writer.setFrame('TIT2', metadata.title);
  if (metadata.artist) writer.setFrame('TPE1', [metadata.artist]);
  if (metadata.album) writer.setFrame('TALB', metadata.album);
  
  writer.addTag();
  return new Blob([writer.arrayBuffer], { type: 'audio/mpeg' });
};
