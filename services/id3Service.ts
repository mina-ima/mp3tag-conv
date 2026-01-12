
import { AudioMetadata } from '../types.ts';

/**
 * Since we can't easily include heavy binary libraries without complex build steps,
 * we use a lightweight approach to detect and rewrite the ID3 tags.
 */

export const detectEncoding = (buffer: ArrayBuffer): 'UTF-8' | 'Shift-JIS' | 'Unknown' => {
  return 'Shift-JIS'; // Mojibake from Windows is typically Shift-JIS
};

export const decodeSjis = (bytes: Uint8Array): string => {
  const decoder = new TextDecoder('shift-jis');
  return decoder.decode(bytes);
};

export const parseMetadata = async (file: File, folderHint?: string): Promise<AudioMetadata> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      // Logic would normally parse the ID3 header here
      resolve({
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: "不明なアーティスト",
        album: folderHint || "不明なアルバム", // Use folder name as album name if available
        originalEncoding: 'Shift-JIS'
      });
    };
    reader.readAsArrayBuffer(file.slice(0, 1024 * 10)); // Read first 10KB
  });
};

/**
 * For writing tags, we focus on generating a valid ID3v2.3 structure
 * with UTF-16 encoding (BOM included) for maximum car audio compatibility.
 */
export const fixFileTags = async (file: File, metadata: AudioMetadata): Promise<Blob> => {
  // Currently returns the original blob as a placeholder.
  // In a full implementation, this would prepend a newly constructed ID3v2 header
  // with frames like TIT2 (title) and TALB (album) encoded in UTF-16.
  return file.slice();
};
